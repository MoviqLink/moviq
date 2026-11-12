import type { BoundingBox } from '@moviq/contracts';

/** Reuse the prefetched margin during small pans; tighten the query after a substantial zoom. */
export function needsNewBounds(previous: BoundingBox | null, visible: BoundingBox): boolean {
  if (previous === null) return true;
  const [west, south, east, north] = visible;
  if (west < previous[0] || south < previous[1] || east > previous[2] || north > previous[3]) {
    return true;
  }
  const area = (east - west) * (north - south);
  const previousArea = (previous[2] - previous[0]) * (previous[3] - previous[1]);
  return area > 0 && previousArea > area * 9 * (1 + 1e-9);
}
