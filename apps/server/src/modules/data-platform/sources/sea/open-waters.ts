import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';

/**
 * New York Harbor and its approaches: the Hudson up to the George Washington Bridge, the East
 * River, western Long Island Sound, Jamaica Bay and Raritan Bay. 0.33 square degrees, inside the
 * 100 the anonymous access allows. `max_age=30m` asks only for vessels heard in half an hour.
 */
const BBOX = [40.45, -74.3, 40.95, -73.65] as const;
const URL_AIS = `https://ais.openwaters.io/v1/vessels?bbox=${BBOX.join(',')}&max_age=30m`;

/** Only after one of these is `seen` the time of the position. */
const POSITION_MESSAGES = new Set([
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
]);

/** A moving vessel's position is shown 10 minutes, a stopped one's 30 (as Vektia does). */
const MAX_AGE_MOVING_MS = 10 * MINUTE;
const MAX_AGE_STOPPED_MS = 30 * MINUTE;
const FUTURE_TOLERANCE_MS = MINUTE;

const featureSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  geometry: z
    .object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) })
    .nullable()
    .optional(),
  properties: z.looseObject({
    kind: z.string().optional(),
    mmsi: z.union([z.number(), z.string()]).optional(),
    msg_type: z.string().optional(),
    seen: z.string().optional(),
    name: z.string().optional(),
    sog: z.number().optional(),
    cog: z.number().optional(),
    heading: z.number().optional(),
    type: z.number().optional(),
    destination: z.string().optional(),
    nav_status: z.number().optional(),
    length: z.number().optional(),
    beam: z.number().optional(),
    source: z.string().optional(),
  }),
});

const answerSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(z.unknown()),
  truncated: z.boolean().optional(),
});

const vesselSchema = z.object({
  /** AIS positions come from the vessel's own satellite receiver. */
  located: z.literal('gps'),
  mmsi: z.string().regex(/^\d{9}$/),
  name: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKnots: z.number().min(0).max(102.2).nullable(),
  /** Course over ground and heading, in degrees; null when the signal does not carry them. */
  courseDegrees: z.number().min(0).max(359.9).nullable(),
  headingDegrees: z.number().min(0).max(359).nullable(),
  /** The AIS ship type code (ITU-R M.1371): 60-69 passenger, 70-79 cargo, 80-89 tanker… */
  shipType: z.number().int().nullable(),
  /** As the crew typed it, which can be out of date. */
  destination: z.string().nullable(),
  /** The AIS navigational status code: 0 under way, 1 at anchor, 5 moored… */
  navStatus: z.number().int().min(0).max(15).nullable(),
  lengthMetres: z.number().nullable(),
  beamMetres: z.number().nullable(),
  /** The network that heard it, whose licence the attribution follows. */
  network: z.enum(['AISHub', 'aisstream.io', 'volunteer receivers', 'other']),
  observedAt: instantSchema,
});

const harbourTrafficSchema = z.object({
  /** The newest position of the answer, which is the time of the data. */
  latestPosition: instantSchema,
  vessels: z.array(vesselSchema),
  /** Open Waters cut the answer to its size limit. */
  truncated: z.boolean(),
  leftOut: z.object({
    /** No usable position, or a duplicate MMSI. */
    noPosition: z.number().int().nonnegative(),
    /** The last message was static data, so the position has no known time. */
    noTime: z.number().int().nonnegative(),
    /** Heard too long ago for its speed. */
    old: z.number().int().nonnegative(),
    future: z.number().int().nonnegative(),
  }),
});

type Vessel = z.infer<typeof vesselSchema>;
type LeftOut = z.infer<typeof harbourTrafficSchema>['leftOut'];
export type HarbourTraffic = z.infer<typeof harbourTrafficSchema>;

function within(value: number | undefined, min: number, max: number): number | null {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function networkOf(source: string | undefined): Vessel['network'] {
  if (/^aishub/i.test(source ?? '')) return 'AISHub';
  if (/^aisstream/i.test(source ?? '')) return 'aisstream.io';
  if (/^(station|udp):/i.test(source ?? '')) return 'volunteer receivers';
  return 'other';
}

/** The name with single spaces, or null when the vessel sends none. */
function nameOf(text: string | undefined): string | null {
  const clean = (text ?? '').trim().replace(/\s+/g, ' ');
  return clean === '' ? null : clean;
}

/** The destination without the `@` padding of AIS and extra spaces. */
function destinationOf(text: string | undefined): string | null {
  const clean = (text ?? '').replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean === '' ? null : clean.slice(0, 40);
}

type Outcome = { readonly vessel: Vessel } | { readonly leftOut: keyof LeftOut };

function vesselOf(feature: unknown, receivedAt: number, seen: Set<string>): Outcome | undefined {
  const parsed = featureSchema.safeParse(feature);
  if (!parsed.success) return { leftOut: 'noPosition' };
  const { geometry, properties: p } = parsed.data;
  if (p.kind !== undefined && p.kind !== 'vessel') return undefined;
  const mmsi = String(p.mmsi ?? parsed.data.id ?? '');
  const [longitude, latitude] = geometry?.coordinates ?? [0, 0];
  if (!/^\d{9}$/.test(mmsi) || seen.has(mmsi) || (latitude === 0 && longitude === 0)) {
    return { leftOut: 'noPosition' };
  }
  const time = Date.parse(p.seen ?? '');
  if (!POSITION_MESSAGES.has(p.msg_type ?? '') || Number.isNaN(time)) return { leftOut: 'noTime' };
  if (time - receivedAt > FUTURE_TOLERANCE_MS) return { leftOut: 'future' };
  const speed = within(p.sog, 0, 102.2);
  const maxAge = speed !== null && speed < 1 ? MAX_AGE_STOPPED_MS : MAX_AGE_MOVING_MS;
  if (receivedAt - time > maxAge) return { leftOut: 'old' };
  const candidate = vesselSchema.safeParse({
    located: 'gps',
    mmsi,
    name: nameOf(p.name),
    latitude,
    longitude,
    speedKnots: speed,
    courseDegrees: within(p.cog, 0, 359.9),
    headingDegrees: within(p.heading, 0, 359),
    shipType: p.type !== undefined && Number.isInteger(p.type) ? p.type : null,
    destination: destinationOf(p.destination),
    navStatus:
      p.nav_status !== undefined && Number.isInteger(p.nav_status)
        ? within(p.nav_status, 0, 15)
        : null,
    lengthMetres: within(p.length, 1, 500),
    beamMetres: within(p.beam, 1, 80),
    network: networkOf(p.source),
    observedAt: toInstant(new Date(time)),
  });
  if (!candidate.success) return { leftOut: 'noPosition' };
  seen.add(mmsi);
  return { vessel: candidate.data };
}

function parseHarbour(body: Uint8Array, receivedAt: Date): ParseResult<HarbourTraffic> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const answer = answerSchema.safeParse(decoded.value);
  if (!answer.success) return refuse('unexpected-shape', describeIssue(answer.error));
  const vessels: Vessel[] = [];
  const leftOut: LeftOut = { noPosition: 0, noTime: 0, old: 0, future: 0 };
  const seen = new Set<string>();
  for (const feature of answer.data.features) {
    const outcome = vesselOf(feature, receivedAt.getTime(), seen);
    if (outcome === undefined) continue;
    if ('vessel' in outcome) vessels.push(outcome.vessel);
    else leftOut[outcome.leftOut] += 1;
  }
  // The port of New York always has vessels with AIS on: none means the networks are not heard.
  if (vessels.length === 0) {
    return refuse('no-vessels', `${String(answer.data.features.length)} features, none current.`);
  }
  const latest = new Date(Math.max(...vessels.map((vessel) => Date.parse(vessel.observedAt))));
  const truncated = answer.data.truncated ?? false;
  const moving = vessels.filter((vessel) => (vessel.speedKnots ?? 0) >= 1).length;
  return {
    ok: true,
    data: { latestPosition: toInstant(latest), vessels, truncated, leftOut },
    dataTime: latest,
    coverage: [
      count(vessels.length, 'vessels'),
      count(moving, 'under way'),
      `${String(leftOut.noTime + leftOut.noPosition + leftOut.old + leftOut.future)} left out`,
      ...(truncated ? ['truncated'] : []),
    ].join(', '),
  };
}

/**
 * Vessels in New York Harbor from Open Waters AIS, by anonymous access without an account or a
 * key. Each vessel keeps the network that heard it, as the licence goes by network.
 *
 * Rhythm and freshness: anonymous access allows 120 requests a minute; AISHub positions arrive as
 * a snapshot about a minute behind. Every 2 minutes at rest and every minute while a trip is
 * watched; the newest position five minutes old degrades it.
 *
 * Licence (https://openwaters.io/ais/#license): per source, not relicensed. AISHub contributors
 * are credited with a link to aishub.net; aisstream.io publishes no terms; volunteer receptions
 * are CC0, the aggregate ODbL. Personal use is free; commercial use needs an agreement with
 * Open Waters.
 */
export const openWatersSource: SourceDefinition<HarbourTraffic> = {
  id: 'open-waters-new-york-harbor',
  title: 'Vessels in New York Harbor (AIS)',
  provider: 'Open Waters AIS',
  licence: {
    name: 'Open Waters AIS, licensed per source',
    url: 'https://openwaters.io/ais/#license',
    attribution:
      'Open Waters AIS (https://openwaters.io/ais/), with AISHub contributors ' +
      '(https://www.aishub.net) and aisstream.io',
  },
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: {
    degradedAfterMs: 5 * MINUTE,
    staleAfterMs: 15 * MINUTE,
    unavailableAfterMs: 30 * MINUTE,
  },
  limits: { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: harbourTrafficSchema,
  request() {
    return { url: URL_AIS, headers: { accept: 'application/geo+json, application/json' } };
  },
  parse(body, { receivedAt }) {
    return parseHarbour(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.latestPosition, previous?.latestPosition);
  },
  consumers: ['live-map'],
  failures: [
    ...httpFailures('ais.openwaters.io', 'https://openwaters.io/ais/'),
    {
      code: 'http-429',
      detection: 'Open Waters answers 429: over the 120 anonymous requests a minute',
      state: 'rate_limited',
      remedy: 'Wait for Retry-After; the last vessels are served with their age',
    },
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page',
      state: 'degraded',
      remedy: 'Keep the last good vessels with their age; the next run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'The answer is not a GeoJSON FeatureCollection with features',
      state: 'misconfigured',
      remedy: 'Compare with the capture and the Open Waters API, then update the reader',
    },
    {
      code: 'no-vessels',
      detection: 'No vessel with a current, timed position in the harbour',
      state: 'degraded',
      remedy: 'Refused: an empty harbour means the networks are not heard, not no traffic',
    },
    {
      code: 'older-than-served',
      detection: 'The newest position is earlier than the one served, as from a stale cache',
      state: 'degraded',
      remedy: 'Keep the newer vessels; the next run normally brings current ones',
    },
  ],
};
