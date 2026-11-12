import { decodePolyline } from '../../data-platform/sources/mta/polyline.js';
import { feedKey } from './feed-key.js';
import type { TimetableInput } from './inputs.js';
import type { PatternTable, TripTable } from './patterns.js';

/** The shape each trip follows, from `shapes.txt` through the GTFS index. */
export interface RideShapes {
  /** Encoded polylines (`polyline.ts`), each shape once; decoded only for a leg served. */
  readonly lines: readonly string[];
  /** The line of trip `t`, or -1 when its timetable names none or does not hold it. */
  readonly ofTrip: Int32Array;
}

type Point = readonly [number, number];

/**
 * How far a stop may sit from the shape of its trip for the shape to be followed. On the captures
 * of 11/11/2026 every subway stop is within 1 m of its shape and every Queens bus stop within 12 m;
 * a stop farther away means the shape is not the way of the trip, which is then drawn by its stops.
 */
const MAX_STOP_OFFSET_M = 50;

const METRES_PER_DEGREE = 111_320;

/** Each trip's shape, shared by the trips that name it. */
export function compileShapes(
  feeds: readonly { readonly timetable: TimetableInput }[],
  trips: TripTable,
  patterns: PatternTable,
): RideShapes {
  const lines: string[] = [];
  const known = new Map<string, number>();
  const ofTrip = new Int32Array(trips.ids.length).fill(-1);
  for (const [trip, id] of trips.ids.entries()) {
    const feed = patterns.feed[trips.pattern[trip] ?? 0] ?? 0;
    const timetable = feeds[feed]?.timetable;
    const shape = timetable?.trips[id]?.shape;
    if (timetable === undefined || shape === undefined || shape === null) continue;
    const key = feedKey(feed, shape);
    const seen = known.get(key);
    if (seen !== undefined) {
      ofTrip[trip] = seen;
      continue;
    }
    const line = timetable.shapes[shape];
    if (line === undefined) continue;
    known.set(key, lines.length);
    ofTrip[trip] = lines.length;
    lines.push(line);
  }
  return { lines, ofTrip };
}

/** Where a stop meets one segment of the shape: the segment, the point and how far it is. */
interface Match {
  readonly segment: number;
  readonly point: Point;
  readonly metres: number;
}

/** The nearest point of segment `a`-`b` to `p`, on a local flat projection, with its distance. */
function nearest(p: Point, a: Point, b: Point): { readonly point: Point; readonly metres: number } {
  const scale = Math.cos((p[1] * Math.PI) / 180);
  const [ax, ay, bx, by] = [(a[0] - p[0]) * scale, a[1] - p[1], (b[0] - p[0]) * scale, b[1] - p[1]];
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const k = length === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length));
  const [x, y] = [ax + k * dx, ay + k * dy];
  const point: Point = [p[0] + x / scale, p[1] + y];
  return { point, metres: Math.hypot(x, y) * METRES_PER_DEGREE };
}

/**
 * The first pass of the shape near a stop after the previous stop's point: the closest point of
 * the first run of segments within reach, so a line that comes back by the stop later, or passed
 * by it before the previous stop, is not taken.
 */
function firstPass(
  shape: readonly Point[],
  stop: Point,
  after: Match | undefined,
): Match | undefined {
  let best: Match | undefined;
  for (let segment = after?.segment ?? 0; segment < shape.length - 1; segment += 1) {
    const a = segment === after?.segment ? after.point : shape[segment];
    const b = shape[segment + 1];
    if (a === undefined || b === undefined) break;
    const found = nearest(stop, a, b);
    if (found.metres <= MAX_STOP_OFFSET_M) {
      if (best === undefined || found.metres < best.metres) best = { segment, ...found };
    } else if (best !== undefined) break;
  }
  return best;
}

/**
 * The path of a ride along its trip's shape, from the stop it boards at to the one it leaves at:
 * the stops of the trip are met in order from its first, so loops and lines that pass a stop
 * twice are cut where the trip calls. Undefined when the trip has no shape or a stop is not on it.
 */
export function ridePath(
  shapes: RideShapes,
  trip: number,
  stops: readonly Point[],
  board: number,
): Point[] | undefined {
  const line = shapes.lines[shapes.ofTrip[trip] ?? -1];
  const decoded = line === undefined ? undefined : decodePolyline(line);
  if (decoded === undefined || decoded.length < 2 || board < 0 || stops.length - board < 2) {
    return undefined;
  }
  const shape = decoded.map((point): Point => [point.lon, point.lat]);
  const matches: Match[] = [];
  for (const stop of stops) {
    const match = firstPass(shape, stop, matches.at(-1));
    if (match === undefined) return undefined;
    matches.push(match);
  }
  const first = matches[board];
  const last = matches.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const between = shape.slice(first.segment + 1, last.segment + 1);
  const path: Point[] = [];
  for (const point of [stops[board], first.point, ...between, last.point, stops.at(-1)]) {
    const previous = path.at(-1);
    if (point === undefined) continue;
    if (previous?.[0] !== point[0] || previous[1] !== point[1]) path.push(point);
  }
  return path;
}
