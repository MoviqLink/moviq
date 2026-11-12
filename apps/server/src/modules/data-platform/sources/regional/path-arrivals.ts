import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { KnownFailure, ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';
import { httpFailures } from './provider-failures.js';

/**
 * The thirteen stations by the codes RidePATH uses, placed with `stops.txt` of the PATH GTFS that
 * Trillium published for the Port Authority on 22/05/2025
 * (https://data.trilliumtransit.com/gtfs/path-nj-us/path-nj-us.zip). That timetable ended on
 * 01/06/2026 and has no successor, so only the station places are taken from it.
 */
const STATION_CODES = [
  'NWK',
  'HAR',
  'JSQ',
  'GRV',
  'NEW',
  'EXP',
  'HOB',
  'WTC',
  'CHR',
  '09S',
  '14S',
  '23S',
  '33S',
] as const;

type StationCode = (typeof STATION_CODES)[number];

const stationCode = z.enum(STATION_CODES);

interface StationPlace {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

const STATIONS: Readonly<Record<StationCode, StationPlace>> = {
  NWK: { name: 'Newark', latitude: 40.73454, longitude: -74.16375 },
  HAR: { name: 'Harrison', latitude: 40.73942, longitude: -74.15587 },
  JSQ: { name: 'Journal Square', latitude: 40.73301, longitude: -74.06289 },
  GRV: { name: 'Grove Street', latitude: 40.71966, longitude: -74.04245 },
  NEW: { name: 'Newport', latitude: 40.72699, longitude: -74.03383 },
  EXP: { name: 'Exchange Place', latitude: 40.71676, longitude: -74.03238 },
  HOB: { name: 'Hoboken', latitude: 40.73586, longitude: -74.02922 },
  WTC: { name: 'World Trade Center', latitude: 40.71271, longitude: -74.01193 },
  CHR: { name: 'Christopher Street', latitude: 40.73295, longitude: -74.00707 },
  '09S': { name: '9th Street', latitude: 40.73424, longitude: -73.9991 },
  '14S': { name: '14th Street', latitude: 40.73735, longitude: -73.99684 },
  '23S': { name: '23rd Street', latitude: 40.7429, longitude: -73.99278 },
  '33S': { name: '33rd Street', latitude: 40.74912, longitude: -73.98827 },
};

const DIRECTIONS = { ToNY: 'to-new-york', ToNJ: 'to-new-jersey' } as const;

/** RidePATH writes local times with microseconds and an offset: `2026-11-10T21:22:58.758505-05:00`. */
const offsetTime = z.iso.datetime({ offset: true });

const answerSchema = z.object({
  results: z.array(
    z.object({
      consideredStation: z.string(),
      destinations: z.array(
        z.object({
          label: z.enum(['ToNY', 'ToNJ']),
          messages: z.array(
            z.object({
              target: z.string(),
              secondsToArrival: z.string(),
              headSign: z.string(),
              lineColor: z.string(),
              lastUpdated: offsetTime,
            }),
          ),
        }),
      ),
    }),
  ),
});

type Message = z.infer<
  typeof answerSchema
>['results'][number]['destinations'][number]['messages'][number];

const arrivalSchema = z.object({
  /** RidePATH says when a train reaches the station, not where it is. */
  located: z.literal('station'),
  direction: z.enum(['to-new-york', 'to-new-jersey']),
  /** The station code where the train ends (`WTC`, `33S`…). */
  destination: stationCode,
  headsign: z.string().min(1),
  /** One colour per line the train runs, as hexadecimal without `#`. */
  lineColors: z.array(z.string().regex(/^[0-9A-F]{6}$/i)).min(1),
  arrival: instantSchema,
  /** When RidePATH computed this arrival; stations update at different moments. */
  updatedAt: instantSchema,
});

const stationSchema = z.object({
  code: stationCode,
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  arrivals: z.array(arrivalSchema),
});

const pathArrivalsSchema = z.object({
  /** The newest `lastUpdated` of the answer, which is the time of the data. */
  updatedAt: instantSchema,
  stations: z.array(stationSchema),
  /** Messages without a whole number of seconds to arrival, a headsign or a line colour. */
  leftOut: z.number().int().nonnegative(),
});

type Arrival = z.infer<typeof arrivalSchema>;
type Station = z.infer<typeof stationSchema>;
export type PathArrivals = z.infer<typeof pathArrivalsSchema>;

/** Clocks may differ a little; an update further ahead than this has a wrong clock. */
const FUTURE_TOLERANCE_MS = 2 * MINUTE;

/** The arrival a message announces, or undefined when it does not give one that can be shown. */
function arrivalOf(direction: Arrival['direction'], message: Message): Arrival | undefined {
  if (!/^\d+$/.test(message.secondsToArrival)) return undefined;
  const updatedAt = new Date(message.lastUpdated);
  // `secondsToArrival` is counted from `lastUpdated`, when RidePATH computed it.
  const arrival = new Date(updatedAt.getTime() + Number(message.secondsToArrival) * 1000);
  const candidate = arrivalSchema.safeParse({
    located: 'station',
    direction,
    destination: message.target,
    headsign: message.headSign.trim(),
    lineColors: message.lineColor.split(',').map((color) => color.trim()),
    arrival: toInstant(arrival),
    updatedAt: toInstant(updatedAt),
  });
  return candidate.success ? candidate.data : undefined;
}

function stationOf(code: StationCode, arrivals: Arrival[]): Station {
  return { code, ...STATIONS[code], arrivals };
}

function unknownStations(answer: z.infer<typeof answerSchema>): string[] {
  const codes = answer.results.flatMap((result) => [
    result.consideredStation,
    ...result.destinations.flatMap((group) => group.messages.map((message) => message.target)),
  ]);
  return [...new Set(codes.filter((code) => !stationCode.safeParse(code).success))];
}

function parseArrivals(body: Uint8Array, receivedAt: Date): ParseResult<PathArrivals> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const unknown = unknownStations(answer.data);
  if (unknown.length > 0) return refuse('unknown-station', `RidePATH names ${unknown.join(', ')}.`);
  let leftOut = 0;
  const stations: Station[] = answer.data.results.flatMap((result) => {
    const code = stationCode.safeParse(result.consideredStation);
    if (!code.success) return [];
    const arrivals = result.destinations.flatMap((group) =>
      group.messages.flatMap((message) => {
        const arrival = arrivalOf(DIRECTIONS[group.label], message);
        if (arrival === undefined) leftOut += 1;
        return arrival ?? [];
      }),
    );
    return [stationOf(code.data, arrivals)];
  });
  const times = stations.flatMap((station) => station.arrivals.map((a) => Date.parse(a.updatedAt)));
  // PATH runs at all hours, so an answer without a single train is a failure, not a quiet night.
  if (times.length === 0) {
    return refuse('no-arrivals', `${count(stations.length, 'stations')} without any train.`);
  }
  const updatedAt = new Date(Math.max(...times));
  if (updatedAt.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return refuse('future-update', `The newest update, ${toInstant(updatedAt)}, is after receipt.`);
  }
  return {
    ok: true,
    data: { updatedAt: toInstant(updatedAt), stations, leftOut },
    dataTime: updatedAt,
    coverage: `${count(stations.length, 'stations')}, ${count(times.length, 'arrivals')}, ${String(leftOut)} left out`,
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('panynj.gov', 'the RidePATH page of panynj.gov'),
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML maintenance page of panynj.gov',
    state: 'degraded',
    remedy: 'Keep the last good arrivals with their age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No results list, a direction other than ToNY and ToNJ, or a message without fields',
    state: 'misconfigured',
    remedy: 'RidePATH changed its format: compare with the capture and update the reader',
  },
  {
    code: 'unknown-station',
    detection: 'A station code that is not one of the thirteen placed',
    state: 'misconfigured',
    remedy: 'Place the new station from an official source before serving PATH again',
  },
  {
    code: 'no-arrivals',
    detection: 'No station lists a train, while PATH runs at all hours',
    state: 'degraded',
    remedy: 'Refused; the last good arrivals are served with their age until it runs out',
  },
  {
    code: 'future-update',
    detection: 'The newest lastUpdated is more than 2 minutes after the download',
    state: 'degraded',
    remedy: 'Refused until the provider clock is right again',
  },
  {
    code: 'older-than-served',
    detection: 'The newest lastUpdated is earlier than the one served, as from a stale cache',
    state: 'degraded',
    remedy: 'Keep the newer arrivals; the next run normally brings current ones',
  },
];

/**
 * PATH arrivals at every station, from RidePATH, the Port Authority's own real-time feed behind
 * panynj.gov and the RidePATH app. PATH publishes no GTFS Realtime feed and no developer terms.
 *
 * Rhythm and freshness: the answer is cached for 15 seconds (`cache-control: max-age=15`) and
 * stations update at their own moments: on 11/11/2026 the newest update was 42 seconds old and
 * the oldest 87. Every 30 seconds while a trip is watched, every minute at rest; three minutes
 * without a newer update degrade it and ten make it stale.
 *
 * Licence: the panynj.gov Web Site Disclaimer, the only terms the Port Authority gives: general
 * information, without warranty, all rights reserved.
 */
export const pathArrivalsSource: SourceDefinition<PathArrivals> = {
  id: 'path-arrivals',
  title: 'PATH train arrivals',
  provider: 'Port Authority of New York and New Jersey (RidePATH)',
  licence: {
    name: 'panynj.gov Web Site Disclaimer',
    url: 'https://www.panynj.gov/port-authority/en/web-site-disclaimer.html',
    attribution: 'Real-time arrivals from the Port Authority of New York and New Jersey (RidePATH)',
  },
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: MINUTE, interestIntervalMs: 30_000 },
  freshness: {
    degradedAfterMs: 3 * MINUTE,
    staleAfterMs: 10 * MINUTE,
    unavailableAfterMs: 30 * MINUTE,
  },
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  keepVersions: 1,
  dataSchema: pathArrivalsSchema,
  request() {
    return {
      url: 'https://www.panynj.gov/bin/portauthority/ridepath.json',
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parseArrivals(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.updatedAt, previous?.updatedAt);
  },
  consumers: ['live-map', 'arrivals', 'trip-watch'],
  failures: FAILURES,
};
