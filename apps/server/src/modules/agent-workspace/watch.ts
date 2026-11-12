import { toInstant } from '@moviq/contracts';
import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import { byRoute, mtaAlertsIn, pathAlertsIn } from '../assistant/city/alerts.js';
import { routeOf } from '../assistant/city/lines.js';
import type { SourceReader } from '../data-platform/reader.js';
import { checkRoadWatches } from './road-watch.js';

/** Half of the worker's 200-watch budget, reserved for transit lines. */
const WATCH_BATCH_SIZE = 100;

const rowSchema = z.object({
  id: z.string(),
  line: z.string(),
  saw_alert: z.number(),
  generation: z.number(),
});
export interface WatchReading {
  readonly available: boolean;
  readonly count: number | null;
}
/** Unavailable readings never erase evidence of a previously observed alert. */
export function nextWatch(reading: WatchReading, sawAlert: boolean) {
  if (!reading.available || reading.count === null)
    return { status: 'unavailable', sawAlert, notify: false } as const;
  if (reading.count > 0) return { status: 'active', sawAlert: true, notify: false } as const;
  return { status: 'clear', sawAlert: false, notify: sawAlert } as const;
}
export async function runAgentWatches(
  term: LeaderTerm,
  deps: {
    readonly db: Database;
    readonly clock: Clock;
    readonly reader: SourceReader;
    readonly logger: Logger;
    readonly intervalMs: number;
  },
): Promise<void> {
  while (!term.signal.aborted) {
    try {
      await checkWatches(term, deps);
      await checkRoadWatches(term, deps);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      deps.logger.error('agent watch failed', { error });
    }
    await pause(deps.intervalMs, term.signal);
  }
}
export async function checkWatches(
  term: LeaderTerm,
  deps: { readonly db: Database; readonly clock: Clock; readonly reader: SourceReader },
): Promise<void> {
  const result = await deps.db.query({
    sql: `SELECT id, line, saw_alert, generation FROM workspace_watches
      WHERE kind = 'line' AND status != 'paused'
      ORDER BY checked_at, created_at, id LIMIT ?`,
    args: [WATCH_BATCH_SIZE],
  });
  for (const value of result.rows) {
    const now = deps.clock.now();
    const watch = parseRow(rowSchema, value, 'workspace_watches');
    const route = routeOf(watch.line);
    if (route === undefined) {
      await term.fenced(async (tx) => {
        await tx.execute({
          sql: `UPDATE workspace_watches SET status = 'unavailable', checked_at = ?, source = NULL
            WHERE id = ? AND generation = ? AND status != 'paused'`,
          args: [toInstant(now), watch.id, watch.generation],
        });
      });
      continue;
    }
    let reading;
    try {
      reading =
        route.mode === 'path'
          ? await pathAlertsIn(deps.reader, route.ids)
          : await mtaAlertsIn(deps.reader, now, byRoute(route.mode, route.ids));
    } catch {
      // A failed source read is unknown, never evidence that the alert cleared.
      reading = undefined;
    }
    const next = nextWatch(
      {
        available: reading !== undefined && !reading.list.aged,
        count: reading?.list.alerts?.length ?? null,
      },
      watch.saw_alert === 1,
    );
    const at = toInstant(now);
    await term.fenced(async (tx) => {
      await tx.execute({
        sql: `UPDATE workspace_watches SET status = ?, saw_alert = ?, checked_at = ?, source = ?,
          alerted_at = CASE WHEN ? = 1 THEN ? ELSE alerted_at END WHERE id = ? AND generation = ? AND
          status != 'paused'`,
        args: [
          next.status,
          next.sawAlert ? 1 : 0,
          at,
          JSON.stringify(reading?.sources[0] ?? null),
          next.notify ? 1 : 0,
          at,
          watch.id,
          watch.generation,
        ],
      });
    });
  }
}
