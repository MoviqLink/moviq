import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Collect } from '../data-platform/collector.js';
import type { SourceDefinition } from '../data-platform/definition.js';
import { healthStore } from '../data-platform/health-store.js';
import type { SourceReader } from '../data-platform/reader.js';
import { planNextRun } from '../data-platform/schedule.js';
import { railTimetableSources } from '../data-platform/sources/regional/rail-timetables.js';
import { passioRouteSource } from '../data-platform/sources/shuttles/passio-routes.js';

/** Refresh old parsed snapshots once, without an ETag that could preserve the old representation. */
export async function upgradeRailTimetables(
  term: LeaderTerm,
  deps: {
    readonly reader: SourceReader;
    readonly db: Database;
    readonly clock: Clock;
    readonly collect: Collect;
  },
): Promise<void> {
  const sources: readonly SourceDefinition[] = [...railTimetableSources, passioRouteSource];
  let attempted = false;
  const stopped = () => term.signal.aborted;
  for (const source of sources) {
    if (stopped()) return;
    const reading = await deps.reader.read(source);
    if (reading.data === undefined) continue; // A new database is collected by the scheduler.
    if (source.needsFullRefresh?.(reading.data) !== true) continue;
    const health = await healthStore.read(deps.db, source.id);
    if (
      health !== undefined &&
      (health.consecutiveFailures > 0 ||
        health.lastOutcome === 'rate_limited' ||
        health.lastOutcome === 'misconfigured')
    ) {
      const next = planNextRun(source, health, {
        now: deps.clock.now(),
        interested: false,
        missingVariables: [],
        random: () => 0.5,
      }).at;
      if (next === undefined || next > deps.clock.now()) continue;
    }
    if (attempted) await new Promise<void>((resolve) => setTimeout(resolve, 2000));
    if (stopped()) return;
    await deps.collect(source, term, {
      trigger: 'schedule',
      requestedBy: null,
      reason: null,
      forceFull: true,
    });
    attempted = true;
  }
}
