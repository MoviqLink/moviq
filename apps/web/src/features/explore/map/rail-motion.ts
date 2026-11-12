import type { LngLat } from './motion';

const METERS = 111_195;
const MAX_OFFSET = 20;
const MAX_MOVE = 2000;
interface Placement {
  readonly at: number;
  readonly offset: number;
}
interface Shape {
  readonly points: readonly LngLat[];
  readonly at: readonly number[];
}

function distance(a: LngLat, b: LngLat): number {
  return Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * METERS;
}
function shapeOf(points: readonly LngLat[]): Shape {
  const at = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    at.push((at[i - 1] ?? 0) + (a === undefined || b === undefined ? 0 : distance(a, b)));
  }
  return { points, at };
}
function locate(shape: Shape, point: LngLat): Placement {
  let best = { at: 0, offset: Infinity };
  const scale = Math.cos((point[1] * Math.PI) / 180);
  for (let i = 1; i < shape.points.length; i += 1) {
    const a = shape.points[i - 1];
    const b = shape.points[i];
    if (a === undefined || b === undefined) continue;
    const dx = (b[0] - a[0]) * scale;
    const dy = b[1] - a[1];
    const px = (point[0] - a[0]) * scale;
    const py = point[1] - a[1];
    const squared = dx * dx + dy * dy;
    const k = squared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / squared));
    const offset = Math.hypot(px - k * dx, py - k * dy) * METERS;
    const start = shape.at[i - 1] ?? 0;
    const end = shape.at[i] ?? start;
    if (offset < best.offset) best = { at: start + k * (end - start), offset };
  }
  return best;
}
function pointAt(shape: Shape, at: number): LngLat {
  let i = 1;
  while (i < shape.at.length - 1 && (shape.at[i] ?? 0) < at) i += 1;
  const a = shape.points[i - 1];
  const b = shape.points[i];
  if (a === undefined || b === undefined) return shape.points[0] ?? [0, 0];
  const start = shape.at[i - 1] ?? 0;
  const end = shape.at[i] ?? start;
  const k = end === start ? 0 : (at - start) / (end - start);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Interpolate only on a verified shape between two nearby published/estimated positions. */
export function railTransition(
  from: LngLat,
  to: LngLat,
  route: readonly LngLat[] | null,
): ((t: number) => LngLat) | null {
  if (route === null || route.length < 2) return null;
  const shape = shapeOf(route);
  const a = locate(shape, from);
  const b = locate(shape, to);
  if (a.offset > MAX_OFFSET || b.offset > MAX_OFFSET || Math.abs(a.at - b.at) > MAX_MOVE)
    return null;
  return (t) => (t <= 0 ? from : t >= 1 ? to : pointAt(shape, a.at + (b.at - a.at) * t));
}
