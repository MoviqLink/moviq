import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import type { SourceDefinition } from '../../data-platform/definition.js';
import { placeOf } from '../files.js';
import { hoursOfDay, shiftDay, startOfDay } from './calendar.js';

/** Sources read at least this often are expected to answer in every hour of the day. */
const EXPECTED_EVERY_HOUR_MS = 30 * 60_000;

interface SourceCoverage {
  readonly sourceId: string;
  /** Hours of service with neither a recorded version nor an answer "unchanged". */
  readonly missingHours: readonly string[];
  readonly lostVersions: number;
}

export interface DayCompleteness {
  readonly complete: boolean;
  readonly judged: number;
  /** Only the sources that miss something. */
  readonly sources: readonly SourceCoverage[];
}

const unchangedRow = z.object({ source_id: z.string(), started_at: z.string() });
const lostRow = z.object({ source_id: z.string(), lost: z.number().int() });

/** Hours in which each source answered that nothing had changed: covered, though not written. */
async function unchangedHours(db: Database, day: string): Promise<Map<string, Set<string>>> {
  const result = await db.query({
    sql: `SELECT source_id, started_at FROM source_runs
          WHERE outcome = 'unchanged' AND started_at >= ? AND started_at < ?`,
    args: [toInstant(startOfDay(day)), toInstant(startOfDay(shiftDay(day, 1)))],
  });
  const hours = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const parsed = parseRow(unchangedRow, row, 'source_runs');
    const set = hours.get(parsed.source_id) ?? new Set<string>();
    set.add(placeOf(new Date(parsed.started_at)).hour);
    hours.set(parsed.source_id, set);
  }
  return hours;
}

async function lostVersions(db: Database, day: string): Promise<Map<string, number>> {
  const result = await db.query({
    sql: 'SELECT source_id, lost_versions AS lost FROM recorder_days WHERE day = ?',
    args: [day],
  });
  return new Map(
    result.rows.map((row) => {
      const parsed = parseRow(lostRow, row, 'recorder_days');
      return [parsed.source_id, parsed.lost];
    }),
  );
}

/**
 * Whether a day was recorded whole: every source with an extractor and a fast enough rhythm
 * covered each hour of its service, and no admitted version was lost. Slower sources are judged
 * by their lost versions only.
 */
export async function judgeDay(
  db: Database,
  day: string,
  definitions: readonly SourceDefinition[],
  recordedHours: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<DayCompleteness> {
  const unchanged = await unchangedHours(db, day);
  const lost = await lostVersions(db, day);
  const hours = hoursOfDay(day);
  const sources = definitions.flatMap((definition): SourceCoverage[] => {
    const hourly = definition.rhythm.baseIntervalMs <= EXPECTED_EVERY_HOUR_MS;
    const covered = (hour: string) =>
      recordedHours.get(definition.id)?.has(hour) === true ||
      unchanged.get(definition.id)?.has(hour) === true;
    const missingHours = hourly
      ? hours
          .filter(({ at }) => definition.servicePeriod?.(at) ?? true)
          .filter(({ hour }) => !covered(hour))
          .map(({ hour }) => hour)
      : [];
    const lostCount = lost.get(definition.id) ?? 0;
    if (missingHours.length === 0 && lostCount === 0) return [];
    return [{ sourceId: definition.id, missingHours, lostVersions: lostCount }];
  });
  return { complete: sources.length === 0, judged: definitions.length, sources };
}
