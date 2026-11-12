import type { Point } from './geo.js';
import { place, pointAt, type Line } from './estimation/line.js';
import type { Timetable } from './timetable.js';

const MAX_OFFSET = 35;

/** A published shape trimmed to ordered observed stops; never infer beyond the evidence. */
function trim(line: Line, stops: readonly Point[]): Line | undefined {
  const positions = stops.map((stop) => place(line, stop));
  if (positions.some((p) => p.offsetMeters > MAX_OFFSET)) return undefined;
  const measures = positions.map((p) => p.meters);
  if (measures.some((value, index) => index > 0 && value < (measures[index - 1] ?? value) - 10))
    return undefined;
  const start = measures[0];
  const end = measures.at(-1);
  if (start === undefined || end === undefined || end - start < 20) return undefined;
  const points: [Point, ...Point[]] = [pointAt(line, start)];
  const at = [0];
  for (let i = 1; i < line.points.length - 1; i += 1) {
    const distance = line.at[i];
    const point = line.points[i];
    if (distance !== undefined && point !== undefined && distance > start && distance < end) {
      points.push(point);
      at.push(distance - start);
    }
  }
  points.push(pointAt(line, end));
  at.push(end - start);
  return { id: line.id, points, at, length: end - start };
}

/** Candidate shapes must agree on the physical segment, not just share two stations. */
function agrees(a: Line, b: Line): boolean {
  return (
    a.points.every((point) => place(b, point).offsetMeters <= MAX_OFFSET) &&
    b.points.every((point) => place(a, point).offsetMeters <= MAX_OFFSET)
  );
}

/** A shared or diverted segment only if every fitting published shape follows the same track. */
export function subwaySegment(
  tripId: string,
  stops: readonly Point[],
  timetable: Timetable,
): Line | undefined {
  if (stops.length < 2) return undefined;
  const match = /^[^.]+\.+([NS])/.exec(tripId.slice(tripId.indexOf('_') + 1));
  if (match === null) return undefined;
  const direction = match[1];
  let chosen: Line | undefined;
  for (const id of timetable.shapeIds()) {
    const path = /^[^.]+\.+([NS])/.exec(id);
    if (path?.[1] !== direction) continue;
    const line = timetable.line(id);
    const segment = line === undefined ? undefined : trim(line, stops);
    if (segment === undefined) continue;
    if (chosen === undefined) chosen = segment;
    else if (!agrees(chosen, segment)) return undefined;
  }
  return chosen;
}
