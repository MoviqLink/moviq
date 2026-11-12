import { toInstant } from '@moviq/contracts';
import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import { current, sourceOf } from '../assistant/city/ports.js';
import type { SourceReader } from '../data-platform/reader.js';
import { nycDotTrafficSpeedsSource } from '../data-platform/sources/city/nyc-dot-traffic-speeds.js';
import { recentMeasurement } from './roads.js';

/** Half of the worker's 200-watch budget, reserved for road segments. */
const WATCH_BATCH_SIZE = 100;

const rowSchema = z.object({
  id: z.string(),
  segment_id: z.string(),
  threshold_kmh: z.number(),
  generation: z.number(),
  saw_alert: z.number(),
  consecutive: z.number(),
  measured_at: z.string().nullable(),
});
export interface RoadState {
  readonly below: boolean;
  readonly consecutive: number;
  readonly measuredAt: string | null;
}
/** Two distinct fresh readings above the threshold after a below-threshold baseline. */
export function nextRoad(state: RoadState, measuredAt: string, speed: number, threshold: number) {
  if (measuredAt === state.measuredAt) return { ...state, notify: false };
  if (state.measuredAt !== null && measuredAt < state.measuredAt)
    return { ...state, notify: false };
  if (speed <= threshold) return { below: true, consecutive: 0, measuredAt, notify: false };
  const consecutive = Math.min(state.consecutive + 1, 2);
  const notify = state.below && consecutive === 2;
  return { below: notify ? false : state.below, consecutive, measuredAt, notify };
}
export async function checkRoadWatches(
  term: LeaderTerm,
  deps: { readonly db: Database; readonly clock: Clock; readonly reader: SourceReader },
): Promise<void> {
  const rows = await deps.db.query({
    sql: `SELECT id, segment_id, threshold_kmh, generation, saw_alert, consecutive, measured_at
      FROM workspace_watches WHERE kind = 'street' AND status != 'paused'
      AND segment_id IS NOT NULL ORDER BY checked_at, created_at, id LIMIT ?`,
    args: [WATCH_BATCH_SIZE],
  });
  if (rows.rows.length === 0) return;
  let reading;
  try {
    reading = await deps.reader.read(nycDotTrafficSpeedsSource);
  } catch {
    reading = undefined;
  }
  for (const row of rows.rows) {
    const watch = parseRow(rowSchema, row, 'workspace_watches');
    const now = deps.clock.now();
    const segment =
      reading !== undefined && current(reading)
        ? reading.data?.segments.find(
            (item) =>
              item.id === watch.segment_id &&
              recentMeasurement(item.measuredAt, now) &&
              (watch.measured_at === null || item.measuredAt >= watch.measured_at),
          )
        : undefined;
    const source = reading === undefined ? null : sourceOf(nycDotTrafficSpeedsSource, reading);
    const speed = segment === undefined ? null : segment.speedMph * 1.609344;
    const next =
      segment === undefined || speed === null
        ? undefined
        : nextRoad(
            {
              below: watch.saw_alert === 1,
              consecutive: watch.consecutive,
              measuredAt: watch.measured_at,
            },
            segment.measuredAt,
            speed,
            watch.threshold_kmh,
          );
    const status =
      speed === null ? 'unavailable' : speed > watch.threshold_kmh ? 'clear' : 'active';
    const at = toInstant(now);
    await term.fenced(async (tx) => {
      await tx.execute({
        sql: `UPDATE workspace_watches SET status = ?, checked_at = ?, source = ?, speed_kmh = ?,
          measured_at = ?, saw_alert = ?, consecutive = ?, alerted_at = CASE WHEN ? = 1 THEN ? ELSE
          alerted_at END WHERE id = ? AND generation = ? AND status != 'paused'`,
        args: [
          status,
          at,
          JSON.stringify(source),
          speed === null ? null : Math.round(speed * 10) / 10,
          next?.measuredAt ?? watch.measured_at,
          next?.below === undefined ? watch.saw_alert : next.below ? 1 : 0,
          next?.consecutive ?? 0,
          next?.notify === true ? 1 : 0,
          at,
          watch.id,
          watch.generation,
        ],
      });
    });
  }
}
