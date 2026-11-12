import type { RecordedEvent } from '../events.js';
import { createReportFollower } from './bus-reports.js';
import type { DayType } from './calendar.js';
import { createStretchSpeeds } from './stretch-speeds.js';
import { createTrackingErrors } from './tracking-errors.js';

/**
 * What a day of bus GPS measures, in two readings of the same reports, as both recorders read
 * a day: the first measures the speed of every stretch; the second replays the estimator with
 * those speeds and judges its `gps-plus` positions against each next report.
 */
export function createBusMeasures(dayType: DayType) {
  const speeds = createStretchSpeeds(dayType);
  let tracking: ReturnType<typeof createTrackingErrors> | undefined;
  let followers = new Map<string, ReturnType<typeof createReportFollower>>();

  return {
    /** One event of a bus source, in the order recorded. */
    add(sourceId: string, event: RecordedEvent): void {
      let follower = followers.get(sourceId);
      if (follower === undefined) {
        const replaying = tracking;
        follower = createReportFollower(
          replaying === undefined
            ? (vehicle, report, previous) => {
                speeds.add(vehicle, report, previous);
              }
            : (vehicle, report, previous) => {
                replaying.add(vehicle, report, previous);
              },
        );
        followers.set(sourceId, follower);
      }
      follower.add(event);
    },

    /** The first reading is over: the reports are read again, replayed with the speeds measured. */
    replay(): void {
      tracking = createTrackingErrors((route, stretch, band) =>
        speeds.typical(route, stretch, band),
      );
      followers = new Map();
    },

    /** The speed of every stretch, `size` stretches at a time. */
    speeds: (size: number) => speeds.batches(size),

    /** The replayed errors, by route and band of age: a few hundred rows. */
    tracking: () => tracking?.rows() ?? [],
  };
}

/** The lines of a bus source the replay reads again, recognised before parsing. */
export const replayedLine = (line: string): boolean =>
  line.includes('"k":"gps"') || line.includes('"k":"held"') || line.includes('"k":"assign"');
