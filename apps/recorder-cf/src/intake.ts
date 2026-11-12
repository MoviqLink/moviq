import { toNewYorkWallClockText } from '../../server/src/infrastructure/clock/new-york.js';
import type { Buffer } from './buffer.js';
import { download, nextAttempt } from './collect.js';
import { splitFeed, type FeedPart } from './gtfs-rt/split.js';
import type { RecorderDeps } from './ports.js';
import { BUDGET_MS, costOf, type RecordedSource } from './sources.js';
import { dayCount, sourceState, type RecorderState } from './state.js';

/** The CPU of splitting a feed into parts, predicted from its size (measured: 1 ms a MiB). */
const SPLIT_BASE_MS = 0.3;
const SPLIT_MS_PER_KIB = 0.001;
/** Downloads started by one alarm: a few under the 50 subrequests and 6 connections of the plan. */
const DOWNLOADS_PER_ALARM = 12;

/** A part waiting to be read. */
export interface Item {
  readonly source: RecordedSource;
  readonly part: number;
  readonly body: Uint8Array;
  readonly receivedAt: Date;
  /** The CPU the part is predicted to take, from its size. */
  readonly cost: number;
}

export const hourOf = (ms: number): string => {
  const text = toNewYorkWallClockText(new Date(ms));
  return `${text.slice(0, 10)}/${text.slice(11, 13)}`;
};

export const dayOf = (instant: Date): string => toNewYorkWallClockText(instant).slice(0, 10);

interface IntakeContext {
  readonly deps: RecorderDeps;
  readonly state: RecorderState;
  readonly buffer: Buffer;
  readonly queue: Item[];
}

/**
 * What comes in: the downloads of the sources that are due, their back-off, and their parts in
 * the queue with the CPU each is predicted to take; a part without entities is not queued.
 */
export function createIntake({ deps, state, buffer, queue }: IntakeContext) {
  /** Notes that a source answered in an hour of a New York day. */
  const coverHour = (day: string, sourceId: string, ms: number) => {
    const hours = dayCount(state, day, sourceId).hours;
    const hour = hourOf(ms).slice(11, 13);
    if (!hours.includes(hour)) hours.push(hour);
  };
  /** Downloads what is due, and returns the CPU predicted for splitting it into parts. */
  async function downloadDue(nowMs: number): Promise<number> {
    const due = deps.sources
      .filter((source) => sourceState(state, source.definition.id, source.parts).nextAt <= nowMs)
      .slice(0, DOWNLOADS_PER_ALARM);
    const sizes = await Promise.all(due.map((source) => downloadOne(source, nowMs)));
    return sizes.reduce(
      (total, bytes) =>
        total + (bytes === 0 ? 0 : SPLIT_BASE_MS + (SPLIT_MS_PER_KIB * bytes) / 1024),
      0,
    );
  }

  /** One download; returns the bytes it split into parts, 0 when it split none. */
  async function downloadOne(source: RecordedSource, nowMs: number): Promise<number> {
    const id = source.definition.id;
    const own = sourceState(state, id, source.parts);
    const result = await download(deps.http, source, own, new Date(nowMs));
    const day = dayOf(new Date(nowMs));
    if (result.kind === 'failed') {
      own.failures += 1;
      own.lastError = result.why;
      own.nextAt = nextAttempt(source, own.failures, nowMs, result.retryAfterMs, deps.random);
      dayCount(state, day, id).failed += 1;
      buffer.add(hourOf(nowMs), undefined, undefined, [`${id} failed: ${result.why}`], nowMs);
      return 0;
    }
    own.failures = 0;
    own.lastError = null;
    own.lastAnswerAt = nowMs;
    own.nextAt = nextAttempt(source, 0, nowMs, undefined, deps.random);
    if (result.kind === 'unchanged') {
      dayCount(state, day, id).unchanged += 1;
      coverHour(day, id, nowMs);
      return 0;
    }
    own.etag = result.etag ?? null;
    let parts: FeedPart[];
    try {
      parts = splitFeed(result.body, source.parts, source.splitBy);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      dayCount(state, day, id).rejected += 1;
      buffer.add(
        hourOf(nowMs),
        undefined,
        undefined,
        [`${id} rejected: not-protobuf: ${why}`],
        nowMs,
      );
      return 0;
    }
    const heavy: string[] = [];
    for (const [part, { body, entities }] of parts.entries()) {
      // A part without entities has nothing to record: no trip or vehicle falls in it now.
      if (entities === 0) continue;
      const cost = costOf(source, body.byteLength);
      if (cost > BUDGET_MS) heavy.push(`${String(part)} (${cost.toFixed(1)} ms)`);
      queue.push({ source, part, body, receivedAt: new Date(nowMs), cost });
    }
    // A part predicted over the budget is still read, alone; the audit says the parts are few.
    if (heavy.length > 0)
      buffer.add(
        hourOf(nowMs),
        undefined,
        undefined,
        [`${id} parts over budget: ${heavy.join(', ')}`],
        nowMs,
      );
    return source.parts > 1 ? result.body.byteLength : 0;
  }

  return { downloadDue, coverHour };
}
