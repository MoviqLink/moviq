import type { Point } from '../geo.js';
import { OFF_LINE_METERS } from '../estimation/gps-plus.js';
import { place, type Line } from '../estimation/line.js';
import type { Timetable } from '../timetable.js';

interface TrainPath {
  readonly route: string;
  readonly direction: string;
  readonly pattern: string;
}

/** `A..N55R`, `SI.N03R` and `SI..N03R` are route, direction and pattern joined by dots. */
function pathOf(id: string): TrainPath | undefined {
  const match = /^([^.]+)\.+([NS])(.*)$/.exec(id);
  if (match === null) return undefined;
  const [, route = '', direction = '', pattern = ''] = match;
  return { route, direction, pattern };
}

/** The farthest of the stops from the line, in metres. */
function farthest(line: Line, stops: readonly Point[]): number {
  return Math.max(...stops.map((stop) => place(line, stop).offsetMeters));
}

/**
 * The line of a subway train. The MTA builds a trip id from its origin time and its path
 * (`109850_A..N55R`) and names the shapes of the timetable by path (`A..N55R`; `SI..N03R` for
 * `SI.N03R`). A path without its pattern (`L..S`), or one the timetable lacks, takes the shape
 * of the same route and direction that passes nearest its next stops, if it passes by all of
 * them; otherwise the train has no line.
 */
export function lineOfTrain(
  tripId: string,
  nextStops: readonly Point[],
  timetable: Timetable,
): Line | undefined {
  const path = pathOf(tripId.slice(tripId.indexOf('_') + 1));
  if (path === undefined) return undefined;
  const candidates: string[] = [];
  for (const shapeId of timetable.shapeIds()) {
    const shape = pathOf(shapeId);
    if (shape?.route !== path.route || shape.direction !== path.direction) continue;
    if (path.pattern !== '' && shape.pattern === path.pattern) return timetable.line(shapeId);
    candidates.push(shapeId);
  }
  if (nextStops.length === 0) return undefined;
  let best: { readonly line: Line; readonly offset: number } | undefined;
  for (const shapeId of candidates) {
    const line = timetable.line(shapeId);
    const offset = line === undefined ? Number.POSITIVE_INFINITY : farthest(line, nextStops);
    if (
      line !== undefined &&
      offset <= OFF_LINE_METERS &&
      (best === undefined || offset < best.offset)
    ) {
      best = { line, offset };
    }
  }
  return best?.line;
}
