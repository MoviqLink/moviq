import { z } from 'zod';

import type { Clock } from '../../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../../infrastructure/http/client.js';
import type { ProviderOutcome } from '../../../journeys/ports.js';
import {
  failureFromHttp,
  providerProvenance,
  readJson,
  unexpectedShape,
} from '../../on-demand/outcome.js';
import { HOUR } from '../mta/provider.js';
import { ExpiringCache } from './expiring-cache.js';
import { NYC_OPEN_DATA, socrataDate } from './socrata.js';
import { fromStatePlane, toStatePlane, type LatLon } from './state-plane.js';

const SOURCE_ID = 'nyc-parking-signs';
const PROVIDER = 'NYC Open Data (parking regulation signs)';
const LIMITS = { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 } as const;

/** Tiles of 1,000 by 1,000 feet: 157 signs in the one of 10 Av and W 57 St on 11/11/2026. */
const TILE_FEET = 1_000;
/** More signs than this in one tile would mean the answer was cut by the row limit. */
const ROW_LIMIT = 5_000;

const COLUMNS = [
  'order_number',
  'on_street',
  'from_street',
  'to_street',
  'side_of_street',
  'order_completed_on_date',
  'sign_code',
  'sign_description',
  'arrow_direction',
  'sign_x_coord',
  'sign_y_coord',
].join(',');

const feet = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number);
const text = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? null : value.replace(/\s+/g, ' ').trim()));

const signRows = z.array(
  z.object({
    order_number: z.string().min(1),
    on_street: text,
    from_street: text,
    to_street: text,
    side_of_street: text,
    order_completed_on_date: socrataDate.optional(),
    sign_code: z.string().min(1),
    sign_description: z.string().min(1),
    arrow_direction: text,
    sign_x_coord: feet,
    sign_y_coord: feet,
  }),
);

interface ParkingSign {
  /** The work order that put the sign up, as `P-01312838`. */
  readonly order: string;
  readonly street: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly side: string | null;
  /** The sign's text exactly as DOT lists it: hours, days and exceptions are not resolved. */
  readonly code: string;
  readonly text: string;
  readonly arrow: string | null;
  /** The date the work order was completed. */
  readonly since: string | null;
  readonly point: LatLon;
}

interface ParkingSignTile {
  /** The tile, as the state-plane foot of its south-west corner divided by 1,000. */
  readonly tile: { readonly column: number; readonly row: number };
  readonly signs: readonly ParkingSign[];
}

export interface ParkingSignsReader {
  readonly sourceId: string;
  /** The current signs of the tile around a point, asked once a day at most per tile. */
  near(point: LatLon, signal?: AbortSignal): Promise<ProviderOutcome<ParkingSignTile>>;
}

interface ReaderOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
}

function tileUrl(column: number, row: number): string {
  const [west, south] = [column * TILE_FEET, row * TILE_FEET];
  const where = [
    "record_type='Current'",
    `sign_x_coord>=${String(west)}`,
    `sign_x_coord<${String(west + TILE_FEET)}`,
    `sign_y_coord>=${String(south)}`,
    `sign_y_coord<${String(south + TILE_FEET)}`,
  ].join(' AND ');
  const query = `$select=${COLUMNS}&$where=${encodeURIComponent(where)}&$order=order_number,sign_code`;
  return `${NYC_OPEN_DATA}nfid-uabd.json?${query}&$limit=${String(ROW_LIMIT)}`;
}

/**
 * Parking regulation signs, from NYC DOT's "Parking Regulation Locations and Signs" (`nfid-uabd`,
 * updated daily): 441,086 current signs on 11/11/2026, 156,217 in Brooklyn alone, too many for
 * one list. They are asked by tile of the state-plane grid the dataset uses, when a traveller
 * looks at a place, and kept a day. A sign is shown with its text; whether parking is allowed
 * now is never worked out from it.
 */
export function createParkingSignsReader(options: ReaderOptions): ParkingSignsReader {
  const cache = new ExpiringCache<ProviderOutcome<ParkingSignTile>>(24 * HOUR, 400);
  return {
    sourceId: SOURCE_ID,
    async near(point, signal) {
      const { x, y } = toStatePlane(point);
      const tile = { column: Math.floor(x / TILE_FEET), row: Math.floor(y / TILE_FEET) };
      const key = `${String(tile.column)}:${String(tile.row)}`;
      const kept = cache.get(key, options.clock.now());
      if (kept !== undefined) return kept;
      try {
        const response = await options.http.get({
          url: tileUrl(tile.column, tile.row),
          headers: { accept: 'application/json' },
          ...LIMITS,
          signal,
        });
        const outcome = readTile(response.body, tile, options.clock.now());
        if (outcome.ok) cache.set(key, outcome, options.clock.now());
        return outcome;
      } catch (error) {
        return failureFromHttp(error, PROVIDER);
      }
    },
  };
}

function readTile(
  body: Uint8Array,
  tile: ParkingSignTile['tile'],
  receivedAt: Date,
): ProviderOutcome<ParkingSignTile> {
  const json = readJson(body, PROVIDER);
  if (!json.ok) return json;
  const parsed = signRows.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  if (parsed.data.length >= ROW_LIMIT) {
    return {
      ok: false,
      state: 'unavailable',
      code: 'too-many-rows',
      detail: `${PROVIDER} returned ${String(ROW_LIMIT)} signs for one tile, so the answer may be cut.`,
    };
  }
  const signs = parsed.data.map((row) => ({
    order: row.order_number,
    street: row.on_street,
    from: row.from_street,
    to: row.to_street,
    side: row.side_of_street,
    code: row.sign_code,
    text: row.sign_description.trim(),
    arrow: row.arrow_direction,
    since: row.order_completed_on_date ?? null,
    point: fromStatePlane({ x: row.sign_x_coord, y: row.sign_y_coord }),
  }));
  return {
    ok: true,
    value: { tile, signs },
    provenance: providerProvenance({
      sourceId: SOURCE_ID,
      dataTime: null,
      receivedAt,
      evidence: `${PROVIDER} listed ${String(signs.length)} current signs in the tile; the rows carry no time.`,
    }),
  };
}
