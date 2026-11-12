import { z } from 'zod';

import { instantSchema } from './time.js';

/**
 * The statistics the Cloudflare recorder publishes for each New York day it reduces, as compact
 * JSON: `stats/<day>.json`, and `stats/latest.json` for the newest. Rows are tuples in the order
 * their schema names, so a day of the whole city stays small. Every figure carries its count;
 * nothing below a count is filled in.
 */
export const RECORDER_STATS_VERSION = 'moviq-recorder-stats/1';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative();
const mode = z.enum(['subway', 'bus']);
const band = z.enum(['night', 'am-peak', 'midday', 'pm-peak', 'evening']);

/**
 * A distribution at nine levels: the least value measured, the quantiles 5, 10, 25, 50, 75, 90
 * and 95 and the greatest value measured (the `LEVELS` of the position estimator).
 */
const levels = <T extends z.ZodNumber>(value: T) =>
  [value, value, value, value, value, value, value, value, value] as const;

/**
 * `[mode, route, direction, from stop, to stop, band, n, ...nine levels]`, run times in seconds:
 * buses from one departure to the next, the subway from leaving a stop to arriving at the next.
 */
const segmentRow = z.tuple([
  mode,
  z.string(),
  z.string(),
  z.string(),
  z.string(),
  band,
  count,
  ...levels(seconds),
]);

/** `[mode, route, direction, band, n, p50, p90, sum, sum of squares, bunched]`. */
const headwayRow = z.tuple([
  mode,
  z.string(),
  z.string(),
  band,
  count,
  seconds,
  seconds,
  z.number(),
  z.number(),
  count,
]);

/**
 * `[source, horizon from, horizon to, n, ...nine levels]`: the predicted time minus the observed
 * one, in seconds, with its sign (positive when the vehicle came earlier than predicted).
 */
const predictionRow = z.tuple([z.string(), count, count, count, ...levels(z.number())]);

/**
 * `[route, stretch, band, n, median]`: the speed of buses in metres a second on a stretch of
 * street (`x:y:heading`, 250 m squares, as `recorder/nightly/stretch-speeds.ts` keys them).
 */
const speedRow = z.tuple([z.string(), z.string(), band, count, z.number().nonnegative()]);

/**
 * `[route, age from, age to, n, p90]`: how far, in metres, the estimator's `gps-plus` position
 * of a bus was from its next GPS report, replayed, by seconds since the report before.
 */
const trackingRow = z.tuple([z.string(), count, count, count, z.number().nonnegative()]);

/** `[mode, route, trip, vehicle, started (Unix s), ended (Unix s), seconds, rule]`. */
const stoppageRow = z.tuple([
  mode,
  z.string(),
  z.string(),
  z.string().nullable(),
  count,
  count,
  count,
  z.string(),
]);

/** `[kind, type, route ("*" for all), n, closed, open, p50 s, p90 s]`; p50 and p90 null until reached. */
const incidentRow = z.tuple([
  z.string(),
  z.string(),
  z.string(),
  count,
  count,
  count,
  seconds.nullable(),
  seconds.nullable(),
]);

const coverageSchema = z.object({
  sourceId: z.string().min(1),
  /** New York hours (`HH`) of service in which nothing was recorded or confirmed unchanged. */
  missingHours: z.array(z.string().regex(/^\d{2}$/)),
  /** Downloads refused by the parse, the checks or the schema of the source. */
  rejected: count,
  failed: count,
});

export const recorderStatsSchema = z.object({
  version: z.literal(RECORDER_STATS_VERSION),
  day,
  dayType: z.enum(['weekday', 'saturday', 'sunday']),
  generatedAt: instantSchema,
  /** Complete when every recorded source covered each hour of its service. */
  complete: z.boolean(),
  coverage: z.array(coverageSchema),
  counts: z.object({
    events: count,
    trajectories: count,
    segmentRuns: count,
    predictionsJudged: count,
    predictionsUnmatched: count,
  }),
  segments: z.array(segmentRow),
  headways: z.array(headwayRow),
  predictions: z.array(predictionRow),
  stoppages: z.array(stoppageRow),
  incidents: z.array(incidentRow),
  /** Bus GPS measures; a document without them measured none, and reads as empty. */
  speeds: z.array(speedRow).default([]),
  tracking: z.array(trackingRow).default([]),
});

export type RecorderStats = z.infer<typeof recorderStatsSchema>;
