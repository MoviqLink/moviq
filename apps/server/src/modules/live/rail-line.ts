import type { Point } from './geo.js';
import { place, type Line } from './estimation/line.js';
import type { Timetable } from './timetable.js';

/** A matched trip shape only if its nearby stops agree and it is unambiguous. */
export function railLine(
  timetable: Timetable,
  tripId: string,
  number: string | null,
  route: string,
  direction: 0 | 1 | null,
  stops: readonly Point[],
): Line | undefined {
  const direct = timetable.trip(tripId);
  if (
    direct?.route === route &&
    direct.shape !== null &&
    direct.shape !== undefined &&
    (direction === null || direct.direction === null || direction === direct.direction)
  ) {
    return timetable.line(direct.shape);
  }
  if (stops.length < 2) return undefined;
  const candidates = timetable.tripsForRoute(route, number);
  const ids = new Set(
    candidates.flatMap((trip) =>
      trip.shape !== null &&
      trip.shape !== undefined &&
      (direction === null || trip.direction === null || direction === trip.direction)
        ? [trip.shape]
        : [],
    ),
  );
  const matches: Line[] = [];
  for (const id of ids) {
    const line = timetable.line(id);
    if (line !== undefined && stops.every((stop) => place(line, stop).offsetMeters <= 100))
      matches.push(line);
    if (matches.length > 1) return undefined;
  }
  return matches[0];
}
