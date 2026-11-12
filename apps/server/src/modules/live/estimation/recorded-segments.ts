import { toInstant } from '@moviq/contracts';

import { fromGtfsDate } from '../../../infrastructure/clock/new-york.js';
import { shiftDay } from '../../recorder/nightly/calendar.js';
import type { Reading } from '../../recorder/reading.js';
import type { SegmentKey } from '../../recorder/reading-estimation.js';
import { usableDistribution, type RecordedDistribution } from './statistics.js';

/** Keys waiting to be read at most; one asked beyond it is asked again on the next build. */
const MAX_WAITING = 2_000;

/** Midnight in New York at the start of a day `YYYY-MM-DD`. */
const startOfDay = (day: string) => fromGtfsDate(day.replaceAll('-', ''));

/**
 * How many measures a reading of the recorder rests on, from the start of the first New York day
 * measured to the end of the last one (the recorder keeps the day of each sample, not its
 * moment); undefined when it has no figure.
 */
export function measuredSpan(reading: Reading<unknown>) {
  if (reading.status !== 'ok') return undefined;
  const span = daySpan(reading.from, reading.to);
  return span === undefined ? undefined : { n: reading.n, ...span };
}

/** From the start of the New York day `first` to the end of the day `last`, as instants. */
export function daySpan(first: string, last: string) {
  const from = startOfDay(first);
  const after = startOfDay(shiftDay(last, 1));
  if (from === undefined || after === undefined) return undefined;
  return { from: toInstant(from), to: toInstant(new Date(after.getTime() - 1)) };
}

/** A reading as the estimator takes it: seconds at each level, or null below 20 measures. */
export function asDistribution(reading: Reading<readonly number[]>): RecordedDistribution | null {
  const span = measuredSpan(reading);
  if (span === undefined || reading.status !== 'ok') return null;
  return usableDistribution({ ...span, seconds: [...reading.value] });
}

interface Entry<V> {
  readonly value: V | null;
  /** The renewal it was read in. */
  readonly generation: number;
}

/**
 * What the estimator asks for, key by key, kept in memory. An answer is given at once from what
 * is kept; a key not read yet, or not since the last renewal, is read in the background, one at
 * a time, and answered on the next build. A key not asked for since the renewal before last is
 * forgotten.
 */
export function createReadCache<K, V>(
  idOf: (key: K) => string,
  read: (key: K) => Promise<V | null>,
  onError: (error: unknown) => void,
) {
  const entries = new Map<string, Entry<V>>();
  const waiting = new Map<string, K>();
  let generation = 0;
  let stopped = false;
  let reading: Promise<void> | undefined;
  /** The key being read now. */
  let current: string | undefined;

  async function drain(): Promise<void> {
    for (const [id, key] of waiting) {
      if (stopped) return;
      waiting.delete(id);
      current = id;
      const asked = generation;
      try {
        entries.set(id, { value: await read(key), generation: asked });
      } catch (error) {
        entries.set(id, { value: entries.get(id)?.value ?? null, generation: asked });
        onError(error);
      } finally {
        current = undefined;
      }
    }
  }

  function schedule(): void {
    if (reading !== undefined || stopped) return;
    reading = drain().finally(() => {
      reading = undefined;
      if (waiting.size > 0) schedule();
    });
  }

  return {
    get(key: K): V | null {
      const id = idOf(key);
      const entry = entries.get(id);
      const due = entry === undefined || entry.generation < generation;
      if (due && id !== current && waiting.size < MAX_WAITING) {
        waiting.set(id, key);
        schedule();
      }
      return entry?.value ?? null;
    },

    /** Every key is read again the next time it is asked for. */
    renew(): void {
      generation += 1;
      for (const [id, entry] of entries) if (entry.generation < generation - 1) entries.delete(id);
    },

    /** Resolves once every key asked for so far has been read. */
    settled: (): Promise<void> => reading ?? Promise.resolve(),

    /** Reads nothing more; resolves once the read in flight has ended. */
    stop(): Promise<void> {
      stopped = true;
      waiting.clear();
      return reading ?? Promise.resolve();
    },
  };
}

/** The run times of the segments the estimator asks for, kept as `createReadCache` keeps them. */
export const createSegmentCache = (
  read: (key: SegmentKey) => Promise<RecordedDistribution | null>,
  onError: (error: unknown) => void,
) => createReadCache(segmentId, read, onError);

export const segmentId = (key: SegmentKey) =>
  JSON.stringify([key.mode, key.route, key.from, key.to, key.band, key.dayType]);
