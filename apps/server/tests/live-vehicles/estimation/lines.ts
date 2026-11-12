import { encodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { lineOf, type Line } from '../../../src/modules/live/estimation/line.js';
import type { Point } from '../../../src/modules/live/geo.js';

/** Metres per degree of latitude on the mean Earth radius, as haversine gives them. */
const METERS_PER_DEGREE = 111_195.08;

/** The point `meters` north of 40° N, 74° W: on the straight test line. */
export const north = (meters: number): Point => ({
  lat: 40 + meters / METERS_PER_DEGREE,
  lon: -74,
});

/** A straight line northwards from 40° N, 74° W, `meters` long, with a point every 100 m. */
export function straightLine(id: string, meters: number): Line {
  const points = Array.from({ length: Math.floor(meters / 100) + 1 }, (_, index) =>
    north(index * 100),
  );
  const line = lineOf(id, encodePolyline(points));
  if (line === undefined) throw new Error('no test line');
  return line;
}
