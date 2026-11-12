import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from '../city/parsing.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { NY511_LICENCE, NY511_PROVIDER, ny511Failures } from './provider.js';

const LAYER_URL = 'https://nysdot-special-layers.carsprogram.org/api/v1/travel-times/map-features';

const approachRowSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  direction: z.string(),
  /** The whole travel time in seconds; `minutes` is the same, rounded. */
  seconds: z.number().int().nonnegative().nullable(),
  status: z.string().min(1),
  statusLabel: z.string().min(1),
  typical: z.boolean(),
  updated: z.number().int().positive().nullable(),
});

const crossingFeatureSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.string().min(1),
    statusLabel: z.string().min(1),
    updated: z.number().int().positive(),
    approaches: z.array(approachRowSchema).min(1),
  }),
});

const layerBodySchema = z.object({ features: z.array(crossingFeatureSchema) });

const approachSchema = z.object({
  id: z.string().min(1),
  /** As `Lincoln Tunnel W: NY to NJ TPK via North`. */
  description: z.string().min(1),
  direction: z.string(),
  /** Null when the approach is not reporting. */
  seconds: z.number().int().nonnegative().nullable(),
  status: z.string().min(1),
  statusLabel: z.string().min(1),
  /** The provider marks a typical time rather than a measured one. */
  typical: z.boolean(),
  updatedAt: instantSchema.nullable(),
});

const crossingSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  statusLabel: z.string().min(1),
  updatedAt: instantSchema,
  point: z.tuple([z.number(), z.number()]),
  approaches: z.array(approachSchema),
});

const crossingTimesSchema = z.object({
  /** The newest time of the crossings, which is the time of the data. */
  updatedAt: instantSchema,
  crossings: z.array(crossingSchema),
});

export type CrossingTimes = z.infer<typeof crossingTimesSchema>;

/** The Port Authority's Hudson and Staten Island crossings: 8 points on 11/11/2026. */
const MINIMUM_CROSSINGS = 6;

function parseCrossings(body: Uint8Array): ParseResult<CrossingTimes> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = layerBodySchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const features = parsed.data.features;
  if (features.length === 0) return refuse('check-failed', 'No crossing in the layer.');
  const crossings = features.map(({ geometry, properties }) => ({
    id: properties.id,
    name: properties.title,
    status: properties.status,
    statusLabel: properties.statusLabel,
    updatedAt: toInstant(new Date(properties.updated)),
    point: geometry.coordinates,
    approaches: properties.approaches.map(({ updated, ...approach }) => ({
      ...approach,
      updatedAt: updated === null ? null : toInstant(new Date(updated)),
    })),
  }));
  const newest = new Date(Math.max(...features.map((feature) => feature.properties.updated)));
  const approaches = crossings.flatMap((crossing) => crossing.approaches);
  const measured = approaches.filter((approach) => approach.seconds !== null).length;
  return {
    ok: true,
    data: { updatedAt: toInstant(newest), crossings },
    dataTime: newest,
    coverage: [
      `${String(crossings.length)} crossings`,
      `${String(measured)} of ${String(approaches.length)} approaches timed`,
    ].join(', '),
  };
}

/**
 * Travel times over the Port Authority's bridges and tunnels (Lincoln, Holland, George
 * Washington, Bayonne, Goethals, Outerbridge), approach by approach, on a layer of 511NY's map
 * that its map asks every minute. Its time moved from 04:24 to 04:26 UTC between two reads on
 * 11/11/2026, and was 4 to 12.5 minutes old on arrival: every 5 minutes, every 2 while a trip is
 * watched; 20 minutes without a newer time degrade it.
 */
export const ny511CrossingTimes: SourceDefinition<CrossingTimes> = {
  id: 'ny511-crossing-times',
  title: 'Port Authority crossing times (511NY)',
  provider: NY511_PROVIDER,
  licence: NY511_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 5 * MINUTE, interestIntervalMs: 2 * MINUTE },
  freshness: {
    degradedAfterMs: 20 * MINUTE,
    staleAfterMs: 45 * MINUTE,
    unavailableAfterMs: 2 * HOUR,
  },
  limits: { timeoutMs: 30_000, maxBytes: 1024 * 1024 },
  keepVersions: 1,
  dataSchema: crossingTimesSchema,
  request() {
    return { url: LAYER_URL, headers: { accept: 'application/json' } };
  },
  parse(body) {
    return parseCrossings(body);
  },
  check(data, previous) {
    const reasons = [...olderThanServed(data.updatedAt, previous?.updatedAt)];
    if (data.crossings.length < MINIMUM_CROSSINGS) {
      reasons.push(
        `${String(data.crossings.length)} crossings, minimum ${String(MINIMUM_CROSSINGS)}`,
      );
    }
    return reasons;
  },
  consumers: ['road-times', 'live-map'],
  failures: [
    ...ny511Failures(`No crossing, or fewer than ${String(MINIMUM_CROSSINGS)}`),
    {
      code: 'older-than-served',
      detection: 'The newest crossing time is earlier than the one served, as from a stale cache',
      state: 'degraded',
      remedy: 'Keep the newer times; the next run normally brings current ones',
    },
  ],
};
