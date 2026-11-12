import { z } from 'zod';

/**
 * What the recorder keeps between alarms, saved as one JSON row at most once a minute: when each
 * source is due, its failures, its ETag, the last version of each part, the incidents still open
 * and the counts of each New York day that the nightly reduction and the status read.
 */
const partSchema = z.object({
  version: z.string().nullable(),
  /** Unix seconds of the data last admitted, and since when it has not moved. */
  dataTime: z.number().nullable(),
  sameSince: z.number().nullable(),
  frozen: z.boolean(),
});

const sourceStateSchema = z.object({
  nextAt: z.number(),
  failures: z.number().int().nonnegative(),
  etag: z.string().nullable(),
  lastAnswerAt: z.number().nullable(),
  lastError: z.string().nullable(),
  run: z.number().int().nonnegative(),
  parts: z.array(partSchema),
});

export const dayCountSchema = z.object({
  versions: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  /** New York hours (`HH`) with a version recorded or an answer "unchanged". */
  hours: z.array(z.string()),
});

const openIncidentSchema = z.object({ fingerprint: z.string(), since: z.number() });

export const recorderStateSchema = z.object({
  sources: z.record(z.string(), sourceStateSchema),
  /** `day → source → counts`, for the last few New York days. */
  days: z.record(z.string(), z.record(z.string(), dayCountSchema)),
  incidents: z.record(z.string(), z.record(z.string(), openIncidentSchema)),
  /** The last New York day handed to the nightly reduction. */
  reducedUpTo: z.string().nullable(),
  /** When this state was saved, and how many times the object has started. */
  savedAt: z.number().nullable(),
  starts: z.number().int().nonnegative(),
  /**
   * Rows the recorder wrote in SQLite in a UTC day (the free plan's 100,000 reset at 00:00 UTC):
   * one per alarm set, per buffer row and its deletion, per state saved.
   */
  rows: z.object({ day: z.string(), count: z.number().int().nonnegative() }),
});

export type RecorderState = z.infer<typeof recorderStateSchema>;
export type SourceState = z.infer<typeof sourceStateSchema>;
export type PartState = z.infer<typeof partSchema>;
export type DayCount = z.infer<typeof dayCountSchema>;

export const emptyState = (): RecorderState => ({
  sources: {},
  days: {},
  incidents: {},
  reducedUpTo: null,
  savedAt: null,
  starts: 0,
  rows: { day: '', count: 0 },
});

/** The free plan's rows written a day; the audit says when the recorder comes near them. */
export const FREE_ROWS_PER_DAY = 100_000;

/** Counts rows written in the UTC day of `nowMs`; true the first time they reach 90 %. */
export function countRows(state: RecorderState, nowMs: number, rows: number): boolean {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  if (state.rows.day !== day) state.rows = { day, count: 0 };
  const before = state.rows.count;
  state.rows.count += rows;
  const near = FREE_ROWS_PER_DAY * 0.9;
  return before < near && state.rows.count >= near;
}

export const emptyPart = (): PartState => ({
  version: null,
  dataTime: null,
  sameSince: null,
  frozen: false,
});

export function sourceState(state: RecorderState, sourceId: string, parts: number): SourceState {
  const found = state.sources[sourceId];
  if (found?.parts.length === parts) return found;
  const fresh: SourceState = {
    nextAt: 0,
    failures: 0,
    etag: null,
    lastAnswerAt: null,
    lastError: null,
    run: found?.run ?? 0,
    parts: Array.from({ length: parts }, emptyPart),
  };
  state.sources[sourceId] = fresh;
  return fresh;
}

export function dayCount(state: RecorderState, day: string, sourceId: string): DayCount {
  const days = (state.days[day] ??= {});
  return (days[sourceId] ??= {
    versions: 0,
    unchanged: 0,
    rejected: 0,
    failed: 0,
    events: 0,
    bytes: 0,
    hours: [],
  });
}

/** Days of counts kept: today, yesterday waiting for its reduction, and one more. */
const DAYS_KEPT = 3;

export function pruneDays(state: RecorderState): void {
  const days = Object.keys(state.days).sort();
  for (const day of days.slice(0, Math.max(0, days.length - DAYS_KEPT)))
    Reflect.deleteProperty(state.days, day);
}
