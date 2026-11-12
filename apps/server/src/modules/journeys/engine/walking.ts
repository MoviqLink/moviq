/**
 * Walking times from straight-line distances, since the engine has no street graph.
 *
 * - Speed 1.2 m/s: below the comfortable gait of adults, 1.27 to 1.46 m/s by age group
 *   (Bohannon, "Comfortable and maximum walking speed of adults aged 20-79 years", Age and Ageing
 *   26(1), 1997), and above the 3.5 ft/s (1.07 m/s) the MUTCD uses to time pedestrian clearance
 *   (FHWA, MUTCD 2009, section 4E.06). The gap covers waiting at crossings.
 * - Detour factor 1.3: on a rectangular street grid the walked distance between two points is on
 *   average 4/π ≈ 1.27 times the straight line, over all directions; rounded up.
 */
const WALK_SPEED_M_PER_S = 1.2;
const DETOUR_FACTOR = 1.3;

/**
 * Changing vehicles at the same stop takes at least a minute where the timetable sets no time,
 * as the default transfer slack of OpenTripPlanner 2 (`transferSlack`, 1 minute).
 */
export const SAME_STOP_CHANGE_SECONDS = 60;

/** Footpaths between stops for transfers reach this far in a straight line (about 7 minutes). */
export const TRANSFER_RADIUS_M = 400;

const EARTH_RADIUS_M = 6_371_008.8;
const RADIANS = Math.PI / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RADIANS;
  const dLon = (lon2 - lon1) * RADIANS;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whole seconds to walk a straight-line distance, rounded up. */
export function walkSeconds(metres: number): number {
  return Math.ceil((metres * DETOUR_FACTOR) / WALK_SPEED_M_PER_S);
}

/** The straight-line distance that takes `seconds` to walk. */
export function reachMetres(seconds: number): number {
  return (seconds * WALK_SPEED_M_PER_S) / DETOUR_FACTOR;
}
