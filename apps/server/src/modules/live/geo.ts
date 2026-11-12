/** A point in degrees. */
export interface Point {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(from: Point, to: Point): number {
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from one point to another, in degrees clockwise from north, in [0, 360). */
export function bearingDegrees(from: Point, to: Point): number {
  const lat1 = radians(from.lat);
  const lat2 = radians(to.lat);
  const dLon = radians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/** A bearing the provider gives, folded into [0, 360), or null when it is not a number. */
export function normalBearing(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return ((value % 360) + 360) % 360;
}
