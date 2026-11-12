import { MAX_GAP_MS } from '../../live/estimation/gps-plus.js';
import type { Point } from '../../live/geo.js';
import type { RecordedEvent } from '../events.js';

/** Reports further apart than the estimator follows as one motion are not joined. */
const MAX_GAP_SECONDS = MAX_GAP_MS / 1000;

/** A GPS report of a bus on its trip: where it moved to, or where it keeps standing. */
export interface BusReport {
  readonly route: string;
  readonly trip: string;
  readonly point: Point;
  /** Unix seconds. */
  readonly at: number;
}

/**
 * Each vehicle's reports, in the order recorded, joined to the trip its last `assign` gave:
 * `gps` where it moved, `held` checkpoints where it stood. A report of another trip, or more
 * than five minutes after the one before (the estimator starts again then), has no previous one.
 */
export type ReportListener = (
  vehicle: string,
  report: BusReport,
  previous: BusReport | undefined,
) => void;

export function createReportFollower(...listeners: readonly ReportListener[]) {
  const trips = new Map<string, { readonly trip: string; readonly route: string }>();
  const last = new Map<string, BusReport>();
  return {
    add(event: RecordedEvent): void {
      if (event.k === 'assign') {
        trips.set(event.veh, { trip: event.trip, route: event.route });
        return;
      }
      if (event.k !== 'gps' && event.k !== 'held') return;
      const assigned = trips.get(event.veh);
      if (assigned === undefined || (event.k === 'held' && event.trip !== assigned.trip)) return;
      const before = last.get(event.veh);
      if (before !== undefined && event.t <= before.at) return;
      const report: BusReport = {
        route: assigned.route,
        trip: assigned.trip,
        point: { lat: event.lat, lon: event.lon },
        at: event.t,
      };
      last.set(event.veh, report);
      const joined =
        before?.trip === report.trip && report.at - before.at <= MAX_GAP_SECONDS
          ? before
          : undefined;
      for (const listener of listeners) listener(event.veh, report, joined);
    },
  };
}
