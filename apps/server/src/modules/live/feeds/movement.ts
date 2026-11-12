import type { LiveVehicle } from '@moviq/contracts';

import { normalBearing } from '../geo.js';
import type { Fix, MotionTracker } from '../motion.js';

/** What the operator publishes of a vehicle's movement; null where it publishes nothing. */
interface Reported {
  readonly degrees: number | null;
  readonly kmh: number | null;
}

/**
 * The course and speed of a vehicle reporting GPS: as reported when the operator publishes them,
 * otherwise computed between its last two reports. Each report is remembered for the next one.
 */
export function movementOf(
  tracker: MotionTracker,
  id: string,
  fix: Fix,
  reported: Reported,
): Pick<LiveVehicle, 'bearing' | 'speed'> {
  tracker.observe(id, fix);
  const motion = tracker.motion(id);
  const degrees = normalBearing(reported.degrees);
  const computed = motion?.bearing ?? null;
  return {
    bearing:
      degrees !== null
        ? { degrees, basis: 'reported' }
        : computed === null
          ? null
          : { degrees: computed, basis: 'computed' },
    speed:
      reported.kmh !== null
        ? { kmh: reported.kmh, basis: 'reported', overSeconds: null }
        : motion === undefined
          ? null
          : { kmh: motion.kmh, basis: 'computed', overSeconds: motion.overSeconds },
  };
}

/** The fields only some modes carry (aircraft, ships, shuttles), empty; each mode sets its own. */
export const NO_MODE_DETAILS = {
  operator: null,
  altitudeMeters: null,
  onGround: null,
  usualRoute: null,
  shipType: null,
  occupancy: null,
} as const;

/** Knots, as aircraft and ships report their speed, in km/h. */
export const knotsToKmh = (knots: number): number => knots * 1.852;
