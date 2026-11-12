import { z } from 'zod';

import { instantSchema } from './time.js';

/**
 * The state of a data source. Each one comes from a rule with its evidence:
 * - `healthy`: the data is within its freshness limit;
 * - `degraded`: older than it should be, or the last attempt failed while the data is still usable;
 * - `stale`: too old to rely on, still shown with its age;
 * - `unavailable`: no usable data;
 * - `rate_limited`: the provider asked us to slow down;
 * - `misconfigured`: a credential or the provider's contract is wrong; no retry loop;
 * - `outside_service`: the source does not publish at this time, which is not a failure;
 * - `unknown`: nothing checked yet since start-up.
 */
export const sourceStateSchema = z.enum([
  'healthy',
  'degraded',
  'stale',
  'unavailable',
  'rate_limited',
  'misconfigured',
  'outside_service',
  'unknown',
]);

export type SourceState = z.infer<typeof sourceStateSchema>;

/**
 * The product features that read sources, so operators see what an outage affects:
 * - `trip-planning`: planning backwards from an arrival time;
 * - `trip-watch`: watching a trip live and replanning;
 * - `live-map`: vehicles on the map, Explore;
 * - `arrivals`: next arrivals at stops and stations;
 * - `boarding`: "Have you boarded?";
 * - `step-free`: routes that avoid broken elevators;
 * - `service-alerts`: alerts on routes and stations;
 * - `flights`: airports and flight-based planning;
 * - `weather`: weather along the trip;
 * - `road-times`: road and taxi times;
 * - `sara-briefing`: what Sara tells about the trip.
 */
export const productFeatureSchema = z.enum([
  'trip-planning',
  'trip-watch',
  'live-map',
  'arrivals',
  'boarding',
  'step-free',
  'service-alerts',
  'flights',
  'weather',
  'road-times',
  'sara-briefing',
]);

export type ProductFeature = z.infer<typeof productFeatureSchema>;

/** Where a value comes from and how old it is. Every value shown carries one. */
export const provenanceSchema = z.object({
  sourceId: z.string().min(1),
  /** When the provider produced the data, which is what freshness is measured against. */
  dataTime: instantSchema.nullable(),
  receivedAt: instantSchema.nullable(),
  ageSeconds: z.number().nonnegative().nullable(),
  state: sourceStateSchema,
  evidence: z.string().min(1),
});

export type Provenance = z.infer<typeof provenanceSchema>;

export const runOutcomeSchema = z.enum([
  'admitted',
  'unchanged',
  'rejected',
  'failed',
  'rate_limited',
  'misconfigured',
]);

export type RunOutcome = z.infer<typeof runOutcomeSchema>;

/** One collection attempt of a source, as recorded by the worker. */
export const sourceRunSchema = z.object({
  id: z.number().int().positive(),
  sourceId: z.string().min(1),
  trigger: z.enum(['schedule', 'manual']),
  requestedBy: z.string().nullable(),
  reason: z.string().nullable(),
  startedAt: instantSchema,
  finishedAt: instantSchema,
  outcome: runOutcomeSchema,
  httpStatus: z.number().int().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative(),
  dataTime: instantSchema.nullable(),
  version: z.string().nullable(),
  coverage: z.string().nullable(),
  errorCode: z.string().nullable(),
  detail: z.string().nullable(),
});

export type SourceRun = z.infer<typeof sourceRunSchema>;
