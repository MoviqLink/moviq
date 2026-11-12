import { toNewYorkWallClockText } from '../../../infrastructure/clock/new-york.js';
import { pause } from '../../../infrastructure/clock/pause.js';
import type { LeaderTerm } from '../../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import { recordedDays, removeDay } from '../files.js';
import { stopRequested } from '../signals.js';
import { dropOldSpeeds, reducedDays } from './aggregates-store.js';
import { NIGHTLY_HOUR, dayOf, shiftDay } from './calendar.js';
import { reduceDay, type ReduceDependencies } from './reduce.js';
import { foldSegmentMonths } from './segment-months.js';

export interface NightlyDependencies extends Omit<ReduceDependencies, 'directory'> {
  readonly logger: Logger;
  /** `RECORDING_DIR`. Without it there is nothing to reduce. */
  readonly directory: string | undefined;
  /** Days of raw files kept; aggregates are kept for good. */
  readonly retentionDays: number;
  /** How often to look whether a day is due. */
  readonly checkEveryMs: number;
}

/**
 * The day to reduce now, if any: the oldest recorded day not reduced yet, up to yesterday once
 * it is 04:00 in New York (the day before, earlier). Yesterday is reduced even when nothing was
 * recorded, so that the gap is said, not silent.
 */
export async function dueDay(deps: NightlyDependencies & { directory: string }, now: Date) {
  const today = dayOf(now);
  const hour = Number(toNewYorkWallClockText(now).slice(11, 13));
  const latest = shiftDay(today, hour >= NIGHTLY_HOUR ? -1 : -2);
  const done = await reducedDays(deps.db);
  const candidates = new Set([...(await recordedDays(deps.directory)), latest]);
  return [...candidates].filter((day) => day <= latest && !done.has(day)).sort()[0];
}

/** Deletes raw days older than the retention; their aggregates stay. */
export async function applyRetention(
  directory: string,
  now: Date,
  retentionDays: number,
): Promise<string[]> {
  const oldest = shiftDay(dayOf(now), -retentionDays);
  const removed = (await recordedDays(directory)).filter((day) => day < oldest);
  for (const day of removed) await removeDay(directory, day);
  return removed;
}

/**
 * The nightly process: reduces one due day at a time, applies the retention of raw days, folds
 * the segment samples of whole months older than the detail window and drops older bus speeds.
 */
export async function runNightly(term: LeaderTerm, deps: NightlyDependencies): Promise<void> {
  const { directory } = deps;
  if (directory === undefined) {
    deps.logger.warn('nightly process not started', { reason: 'RECORDING_DIR is not set' });
    return;
  }
  while (!term.signal.aborted) {
    try {
      const now = deps.clock.now();
      const day = await dueDay({ ...deps, directory }, now);
      if (day !== undefined) {
        const outcome = await reduceDay(term, { ...deps, directory }, day);
        deps.logger.info('day reduced', { day, outcome });
      }
      const removed = await applyRetention(directory, now, deps.retentionDays);
      if (removed.length > 0) deps.logger.info('raw recording removed', { days: removed });
      const folded = await foldSegmentMonths(term, deps.db, dayOf(now));
      if (folded.length > 0) deps.logger.info('segment months folded', { months: folded });
      const dropped = await dropOldSpeeds(term, dayOf(now));
      if (dropped > 0) deps.logger.info('old bus speeds dropped', { rows: dropped });
    } catch (error) {
      if (stopRequested(term.signal)) return;
      deps.logger.error('nightly process failed', { error });
    }
    await pause(deps.checkEveryMs, term.signal);
  }
}
