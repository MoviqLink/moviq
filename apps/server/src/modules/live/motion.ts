import { bearingDegrees, distanceMeters, type Point } from './geo.js';

/** One GPS report of a vehicle. */
export interface Fix extends Point {
  /** Milliseconds since the epoch, as the vehicle reported it. */
  readonly at: number;
}

export interface Motion {
  readonly kmh: number;
  /** Seconds between the two reports the speed and course come from. */
  readonly overSeconds: number;
  /** Null when the vehicle did not move enough between them to tell a direction. */
  readonly bearing: number | null;
}

/**
 * Two reports closer than this say nothing reliable about speed; further apart than this, the
 * vehicle may have stopped and started again in between, so an average would mislead.
 */
const MIN_INTERVAL_S = 5;
const MAX_INTERVAL_S = 180;
/** Faster than any city vehicle on the ground: such a pair holds a GPS jump, not a speed. */
const MAX_PLAUSIBLE_KMH = 130;
/** Below this distance a course is GPS noise. */
const MIN_COURSE_M = 15;
/** A vehicle not reported for this long is forgotten. */
const FORGET_AFTER_MS = 15 * 60_000;

interface Track {
  readonly previous: Fix | undefined;
  readonly latest: Fix;
}

/**
 * Remembers the last two distinct GPS reports of each vehicle, in memory and bounded by the
 * fleet, so speed and course can be computed when the operator does not publish them.
 */
export function createMotionTracker() {
  const tracks = new Map<string, Track>();
  return {
    /** Records a report; the same report seen again changes nothing. */
    observe(id: string, fix: Fix): void {
      const track = tracks.get(id);
      if (track === undefined) {
        tracks.set(id, { previous: undefined, latest: fix });
        return;
      }
      if (fix.at <= track.latest.at) return;
      tracks.set(id, { previous: track.latest, latest: fix });
    },

    /** Speed and course between the last two reports, or undefined without two usable ones. */
    motion(id: string): Motion | undefined {
      const track = tracks.get(id);
      if (track?.previous === undefined) return undefined;
      const { previous, latest } = track;
      const seconds = (latest.at - previous.at) / 1000;
      if (seconds < MIN_INTERVAL_S || seconds > MAX_INTERVAL_S) return undefined;
      const meters = distanceMeters(previous, latest);
      const kmh = (meters / seconds) * 3.6;
      if (kmh > MAX_PLAUSIBLE_KMH) return undefined;
      return {
        kmh,
        overSeconds: seconds,
        bearing: meters < MIN_COURSE_M ? null : bearingDegrees(previous, latest),
      };
    },

    /** Drops vehicles whose last report is older than 15 minutes. */
    forget(now: number): void {
      for (const [id, track] of tracks) {
        if (now - track.latest.at > FORGET_AFTER_MS) tracks.delete(id);
      }
    },
  };
}

export type MotionTracker = ReturnType<typeof createMotionTracker>;
