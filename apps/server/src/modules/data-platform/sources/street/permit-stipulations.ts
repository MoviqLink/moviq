import { z } from 'zod';

import type { Clock } from '../../../../infrastructure/clock/clock.js';
import { fromNewYorkWallClockText } from '../../../../infrastructure/clock/new-york.js';
import type { HttpClient } from '../../../../infrastructure/http/client.js';
import type { ProviderOutcome } from '../../../journeys/ports.js';
import {
  failure,
  failureFromHttp,
  providerProvenance,
  readJson,
  unexpectedShape,
} from '../../on-demand/outcome.js';
import { HOUR } from '../mta/provider.js';
import { ExpiringCache } from './expiring-cache.js';
import { NYC_OPEN_DATA } from './socrata.js';

const SOURCE_ID = 'nyc-permit-stipulations';
const PROVIDER = 'NYC Open Data (street permit stipulations)';
const LIMITS = { timeoutMs: 15_000, maxBytes: 512 * 1024 } as const;

/** DOT permit numbers, such as `B022026282B47`. */
const PERMIT_NUMBER = /^[A-Z0-9]{10,16}$/;

const stipulationRows = z.array(
  z.object({
    permitnumber: z.string().min(1),
    stipulationid: z.string().min(1),
    stipulationfulltext: z.string(),
    createdon: z.string(),
  }),
);

interface PermitStipulations {
  readonly permit: string;
  /** The standard conditions attached to the permit, each with its DOT code (`SCHOOL`, `027`). */
  readonly stipulations: readonly { readonly id: string; readonly text: string }[];
}

export interface PermitStipulationsReader {
  readonly sourceId: string;
  /** The conditions of one permit, asked once a day at most per permit. */
  forPermit(permit: string, signal?: AbortSignal): Promise<ProviderOutcome<PermitStipulations>>;
}

interface ReaderOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
}

/**
 * The stipulations of a street construction permit, from NYC DOT's "Street Construction Permits
 * - Stipulations" (`gsgx-6efw`), asked by permit number when a traveller opens a permit: a few
 * hundred thousand rows across the permits in force would not fit one list. The time of the data
 * is the newest `createdon` of its rows, in New York time.
 */
export function createPermitStipulationsReader(options: ReaderOptions): PermitStipulationsReader {
  const cache = new ExpiringCache<ProviderOutcome<PermitStipulations>>(24 * HOUR, 1_000);
  return {
    sourceId: SOURCE_ID,
    async forPermit(permit, signal) {
      if (!PERMIT_NUMBER.test(permit)) {
        return failure('misconfigured', 'bad-query', 'That is not a DOT permit number.');
      }
      const kept = cache.get(permit, options.clock.now());
      if (kept !== undefined) return kept;
      const params = new URLSearchParams({ permitnumber: permit, $order: 'stipulationid' });
      try {
        const response = await options.http.get({
          url: `${NYC_OPEN_DATA}gsgx-6efw.json?${params.toString()}`,
          headers: { accept: 'application/json' },
          ...LIMITS,
          signal,
        });
        const outcome = readStipulations(response.body, permit, options.clock.now());
        if (outcome.ok) cache.set(permit, outcome, options.clock.now());
        return outcome;
      } catch (error) {
        return failureFromHttp(error, PROVIDER);
      }
    },
  };
}

function readStipulations(
  body: Uint8Array,
  permit: string,
  receivedAt: Date,
): ProviderOutcome<PermitStipulations> {
  const json = readJson(body, PROVIDER);
  if (!json.ok) return json;
  const parsed = stipulationRows.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  const rows = parsed.data.filter((row) => row.permitnumber === permit);
  const created = rows
    .map((row) => fromNewYorkWallClockText(row.createdon)?.getTime())
    .filter((time) => time !== undefined);
  return {
    ok: true,
    value: {
      permit,
      stipulations: rows.map((row) => ({
        id: row.stipulationid,
        text: row.stipulationfulltext.trim(),
      })),
    },
    provenance: providerProvenance({
      sourceId: SOURCE_ID,
      dataTime: created.length === 0 ? null : new Date(Math.max(...created)),
      receivedAt,
      evidence: `${PROVIDER} listed ${String(rows.length)} stipulations for the permit.`,
    }),
  };
}
