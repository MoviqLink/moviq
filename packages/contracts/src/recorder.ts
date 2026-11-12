import { z } from 'zod';

import { instantSchema } from './time.js';

/**
 * `recording`: it wrote in the last minutes. `stalled`: it wrote before, but not lately.
 * `waiting`: it never wrote yet. `not-configured`: `RECORDING_DIR` is not set.
 */
const recorderStateSchema = z.enum(['recording', 'stalled', 'waiting', 'not-configured']);

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const countsSchema = z.object({
  versions: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  lostVersions: z.number().int().nonnegative(),
});

const recorderSourceSchema = z.object({
  sourceId: z.string().min(1),
  /** False when no extractor reads this source yet: it is collected but not recorded. */
  recorded: z.boolean(),
  lastVersion: z.string().nullable(),
  lastDataTime: instantSchema.nullable(),
  lastWrittenAt: instantSchema.nullable(),
});

const recorderDaySchema = countsSchema.extend({
  /** New York day of the data. */
  day: daySchema,
  bySource: z.array(countsSchema.extend({ sourceId: z.string().min(1) })),
});

const recorderGapSchema = z.object({
  sourceId: z.string().min(1),
  day: daySchema,
  fromRunId: z.number().int().positive(),
  toRunId: z.number().int().positive(),
  versions: z.number().int().positive(),
  firstDataTime: instantSchema,
  lastDataTime: instantSchema,
  evidence: z.string().min(1),
  recordedAt: instantSchema,
});

const nightlyRunSchema = z.object({
  day: daySchema,
  outcome: z.enum(['complete', 'incomplete', 'no-recording']),
  startedAt: instantSchema,
  finishedAt: instantSchema,
  /** What kept the day from being whole, source by source. */
  missing: z.array(
    z.object({
      sourceId: z.string().min(1),
      missingHours: z.array(z.string()),
      lostVersions: z.number().int().nonnegative(),
    }),
  ),
});

/** `GET /api/ops/recorder`: what the recorder wrote, what it could not, and the last night. */
export const recorderStatusSchema = z.object({
  generatedAt: instantSchema,
  state: recorderStateSchema,
  evidence: z.string().min(1),
  retentionDays: z.number().int().positive(),
  startedAt: instantSchema.nullable(),
  lastWriteAt: instantSchema.nullable(),
  sources: z.array(recorderSourceSchema),
  days: z.array(recorderDaySchema),
  gaps: z.array(recorderGapSchema),
  lastNightly: nightlyRunSchema.nullable(),
});

export type RecorderStatus = z.infer<typeof recorderStatusSchema>;
