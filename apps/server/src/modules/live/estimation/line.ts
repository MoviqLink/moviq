import { decodePolyline } from '../../data-platform/sources/mta/polyline.js';
import { distanceMeters, type Point } from '../geo.js';

/** The shape of a trip as a line to move along: its points and the metres to each from the start. */
export interface Line {
  /** The `shape_id` it comes from. */
  readonly id: string;
  readonly points: readonly [Point, ...Point[]];
  /** Metres along the line to each point; the first is 0 and the last is `length`. */
  readonly at: readonly number[];
  readonly length: number;
}

/** Where a point falls on a line: how far along it and how far off it, both in metres. */
export interface Placement {
  readonly meters: number;
  readonly offsetMeters: number;
}

/** Metres per degree of latitude on the mean Earth radius. */
const METERS_PER_DEGREE = 111_195;

/** The line of an encoded shape, or undefined when the text holds no line of two distinct points. */
export function lineOf(id: string, encoded: string): Line | undefined {
  const [first, ...rest] = decodePolyline(encoded) ?? [];
  if (first === undefined || rest.length === 0) return undefined;
  const points: [Point, ...Point[]] = [first, ...rest];
  const at = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) return undefined;
    at.push((at[index - 1] ?? 0) + distanceMeters(previous, point));
  }
  const length = at.at(-1) ?? 0;
  return length > 0 ? { id, points, at, length } : undefined;
}

/**
 * The nearest point of the segment from `a` to `b` to `p`, as the fraction of the segment and
 * the distance to it, on a plane tangent at `a`: exact enough within a city.
 */
function nearestOnSegment(a: Point, b: Point, p: Point): { fraction: number; offset: number } {
  const scale = Math.cos((a.lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const bx = (b.lon - a.lon) * scale;
  const by = (b.lat - a.lat) * METERS_PER_DEGREE;
  const px = (p.lon - a.lon) * scale;
  const py = (p.lat - a.lat) * METERS_PER_DEGREE;
  const squared = bx * bx + by * by;
  const fraction = squared === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / squared));
  return { fraction, offset: Math.hypot(px - fraction * bx, py - fraction * by) };
}

/**
 * Where `point` falls on `line`: the nearest place on it, searched only between `from` and `to`
 * metres when given, so a line that passes the same corner twice places a vehicle on the stretch
 * it is running.
 */
export function place(line: Line, point: Point, from = 0, to = line.length): Placement {
  let best: Placement = { meters: from, offsetMeters: Number.POSITIVE_INFINITY };
  for (let index = 1; index < line.points.length; index += 1) {
    const start = line.at[index - 1] ?? 0;
    const end = line.at[index] ?? 0;
    const a = line.points[index - 1];
    const b = line.points[index];
    if (a === undefined || b === undefined || end < from || start > to) continue;
    const nearest = nearestOnSegment(a, b, point);
    const meters = Math.min(to, Math.max(from, start + nearest.fraction * (end - start)));
    if (nearest.offset < best.offsetMeters) best = { meters, offsetMeters: nearest.offset };
  }
  return best;
}

/** The point `meters` along the line, held to its ends. */
export function pointAt(line: Line, meters: number): Point {
  const target = Math.min(line.length, Math.max(0, meters));
  let index = 1;
  while (index < line.at.length - 1 && (line.at[index] ?? 0) < target) index += 1;
  const start = line.at[index - 1] ?? 0;
  const end = line.at[index] ?? 0;
  const a = line.points[index - 1] ?? line.points[0];
  const b = line.points[index] ?? a;
  const fraction = end > start ? (target - start) / (end - start) : 0;
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction };
}
