import { Gunzip } from 'fflate';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { refuse } from '../city/parsing.js';
import { csvReader, type CsvRow } from '../mta/csv.js';
import { DAY, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

/** The New York airports by ICAO code; a route is kept when it touches one of them. */
const NEW_YORK_AIRPORTS = ['KJFK', 'KLGA', 'KEWR'] as const;
const newYork: ReadonlySet<string> = new Set(NEW_YORK_AIRPORTS);

/** About half the 11,238 routes through New York of 10/11/2026: a real file has never had so few. */
const MINIMUM_ROUTES = 5_600;

const rowSchema = z.object({
  Callsign: z.string().regex(/^[A-Z0-9]{2,8}$/),
  AirportCodes: z
    .string()
    .transform((codes) => codes.split('-'))
    .pipe(z.array(z.string().regex(/^[A-Z0-9]{4}$/)).min(2)),
});

const routesSchema = z.object({
  /** Airports in flight order (`KJFK`, `EGLL`) by callsign, for the routes through New York. */
  routes: z.record(z.string(), z.array(z.string()).min(2)),
  /** Rows of the table without a callsign or two airports. */
  leftOut: z.number().int().nonnegative(),
});

type UsualRoutes = z.infer<typeof routesSchema>;

const GZIP_MAGIC = [0x1f, 0x8b] as const;

interface Read {
  readonly routes: Record<string, string[]>;
  readonly leftOut: number;
  readonly header: readonly string[];
}

/** Streams the CSV out of the archive, keeping only the routes through New York. */
function readRoutes(body: Uint8Array): Read | string {
  const routes: Record<string, string[]> = {};
  let leftOut = 0;
  let header: readonly string[] = [];
  const reader = csvReader((row: CsvRow) => {
    if (header.length === 0) header = Object.keys(row);
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) {
      leftOut += 1;
      return;
    }
    if (parsed.data.AirportCodes.some((code) => newYork.has(code))) {
      routes[parsed.data.Callsign] = parsed.data.AirportCodes;
    }
  });
  const decoder = new TextDecoder();
  const gunzip = new Gunzip((chunk, final) => {
    reader.write(decoder.decode(chunk, { stream: !final }));
    if (final) reader.end();
  });
  try {
    gunzip.push(body, true);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return { routes, leftOut, header };
}

function parseRoutes(body: Uint8Array, receivedAt: Date): ParseResult<UsualRoutes> {
  if (body[0] !== GZIP_MAGIC[0] || body[1] !== GZIP_MAGIC[1]) {
    const start = new TextDecoder().decode(body.subarray(0, 60)).replace(/\s+/g, ' ');
    return refuse('not-gzip', `The body starts with "${start}".`);
  }
  const read = readRoutes(body);
  if (typeof read === 'string') return refuse('corrupt-gzip', read);
  if (!read.header.includes('Callsign') || !read.header.includes('AirportCodes')) {
    return refuse('unexpected-shape', `Columns are ${read.header.join(', ') || 'missing'}.`);
  }
  const kept = Object.keys(read.routes).length;
  return {
    ok: true,
    data: { routes: read.routes, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage: `${count(kept, 'routes through New York')}, ${String(read.leftOut)} rows left out`,
  };
}

/**
 * The usual route of each callsign through JFK, LaGuardia or Newark, from the Virtual Radar Server
 * standing data that adsb.lol republishes every day (Last-Modified 23:18 UTC on 10/11/2026). It
 * says where a callsign normally flies, not the plan of today's flight, and is shown as such.
 *
 * The file carries no date, so the time of receipt stands in. 4.5 MB compressed, 628,777 rows;
 * only the 11,238 through New York are kept.
 *
 * Licence: CC0 1.0 (https://github.com/vradarserver/standing-data).
 */
export const adsbRoutesSource: SourceDefinition<UsualRoutes> = {
  id: 'adsb-routes',
  title: 'Usual routes of flights through New York',
  provider: 'Virtual Radar Server standing data, served by adsb.lol',
  licence: {
    name: 'CC0 1.0 Universal',
    url: 'https://github.com/vradarserver/standing-data',
    attribution: 'Usual routes from the Virtual Radar Server standing data (CC0)',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: DAY },
  freshness: { degradedAfterMs: 2 * DAY, staleAfterMs: 7 * DAY, unavailableAfterMs: 30 * DAY },
  dataTimeSource: 'receipt',
  limits: { timeoutMs: 2 * MINUTE, maxBytes: 16 * 1024 * 1024 },
  keepVersions: 3,
  dataSchema: routesSchema,
  request() {
    return { url: 'https://vrs-standing-data.adsb.lol/routes.csv.gz' };
  },
  parse(body, { receivedAt }) {
    return parseRoutes(body, receivedAt);
  },
  check(data) {
    const kept = Object.keys(data.routes).length;
    return kept < MINIMUM_ROUTES
      ? [`too-few-routes: ${count(kept, 'routes')}, minimum ${count(MINIMUM_ROUTES, 'routes')}`]
      : [];
  },
  consumers: ['flights', 'live-map'],
  failures: [
    ...httpFailures('vrs-standing-data.adsb.lol', 'https://www.adsb.lol/docs/open-data/api/'),
    {
      code: 'not-gzip',
      detection: 'The body does not start like a gzip file, as with an HTML error page',
      state: 'degraded',
      remedy: 'The served version stays; the next daily run tries again',
    },
    {
      code: 'corrupt-gzip',
      detection: 'The archive does not decompress to its end: a cut download',
      state: 'degraded',
      remedy: 'The served version stays; the next daily run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'No Callsign or AirportCodes column',
      state: 'misconfigured',
      remedy: 'Compare with the capture and the standing data schema, then update the reader',
    },
    {
      code: 'too-few-routes',
      detection: `Fewer than ${String(MINIMUM_ROUTES)} routes through New York: a partial file`,
      state: 'degraded',
      remedy: 'The served version stays; the next daily run tries again',
    },
  ],
};
