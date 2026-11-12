/** Longitude and latitude, as MapLibre takes them. */
export type LngLat = readonly [number, number];

/** One reading of a vehicle: where the data puts it and the course its mark shows. */
export interface Reading {
  readonly id: string;
  readonly mode: string;
  readonly at: LngLat;
  readonly bearing: number;
}

/** A way between two real positions, walked at progress 0 to 1. */
export type Path = (progress: number) => LngLat;

/**
 * How a mark travels from where it was drawn to its latest reading. Every point on the way lies
 * between two real readings: nothing is drawn past the latest one.
 */
export interface Track {
  readonly from: LngLat;
  readonly to: LngLat;
  readonly fromBearing: number;
  readonly toBearing: number;
  /** A verified shape to follow; null for a straight line. */
  readonly path: Path | null;
  /** Browser time the glide started and how long it lasts. */
  readonly start: number;
  readonly duration: number;
  /** Browser time this position was first read, to measure how often the vehicle reports. */
  readonly seenAt: number;
}

export interface RetargetOptions {
  /** False with reduced motion: every mark is placed at its reading at once. */
  readonly glide: boolean;
  readonly pathFor?: (id: string, from: LngLat, to: LngLat) => Path | null;
}

/** The glide lasts as long as the vehicle took to report again, within these bounds. */
const MIN_GLIDE_MS = 4_000;
const MAX_GLIDE_MS = 40_000;
const METERS_PER_DEGREE = 111_195;
/** Reported positions wobble a little; this much is never a jump. */
const SLACK_METERS = 300;

/** Faster than any vehicle of the mode goes in the city: past it, a move is a correction. */
const TOP_KMH: Readonly<Record<string, number>> = {
  bus: 110,
  shuttle: 110,
  subway: 130,
  rail: 200,
  ferry: 80,
  ship: 80,
  aircraft: 1_100,
};
const DEFAULT_TOP_KMH = 150;

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function meters(a: LngLat, b: LngLat): number {
  const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * scale, b[1] - a[1]) * METERS_PER_DEGREE;
}

/** The course between two bearings at progress `k`, turning the short way round. */
export function turn(from: number, to: number, k: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (((from + delta * k) % 360) + 360) % 360;
}

const progressOf = (track: Track, now: number) =>
  track.duration <= 0 ? 1 : clamp((now - track.start) / track.duration, 0, 1);

/** Where the mark is drawn at `now`: a point between its two last real readings. */
export function positionAt(track: Track, now: number): LngLat {
  const k = progressOf(track, now);
  if (k >= 1) return track.to;
  if (track.path !== null) return track.path(k);
  return [
    track.from[0] + (track.to[0] - track.from[0]) * k,
    track.from[1] + (track.to[1] - track.from[1]) * k,
  ];
}

export function bearingAt(track: Track, now: number): number {
  return turn(track.fromBearing, track.toBearing, progressOf(track, now));
}

/** Whether the mark still has some way to go at `now`. */
export function isGliding(track: Track, now: number): boolean {
  return (
    now < track.start + track.duration &&
    (!same(track.from, track.to) || track.fromBearing !== track.toBearing)
  );
}

const still = (reading: Reading, now: number): Track => ({
  from: reading.at,
  to: reading.at,
  fromBearing: reading.bearing,
  toBearing: reading.bearing,
  path: null,
  start: now,
  duration: 0,
  seenAt: now,
});

/**
 * The tracks after a new answer. A known vehicle that moved glides from where it is drawn now to
 * its new reading for as long as it took to report again; a new vehicle, one that moved further
 * than its mode can in that time, or every vehicle when motion is reduced, is placed at once.
 */
export function retarget(
  previous: ReadonlyMap<string, Track>,
  readings: readonly Reading[],
  now: number,
  options: RetargetOptions,
): Map<string, Track> {
  const tracks = new Map<string, Track>();
  for (const reading of readings) {
    const old = previous.get(reading.id);
    if (old !== undefined && same(old.to, reading.at) && old.toBearing === reading.bearing) {
      tracks.set(reading.id, old);
      continue;
    }
    if (old === undefined || !options.glide) {
      tracks.set(reading.id, still(reading, now));
      continue;
    }
    const drawn = positionAt(old, now);
    const elapsed = now - old.seenAt;
    const reach = ((TOP_KMH[reading.mode] ?? DEFAULT_TOP_KMH) / 3.6) * (elapsed / 1000);
    if (meters(drawn, reading.at) > reach + SLACK_METERS) {
      tracks.set(reading.id, still(reading, now));
      continue;
    }
    tracks.set(reading.id, {
      from: drawn,
      to: reading.at,
      fromBearing: bearingAt(old, now),
      toBearing: reading.bearing,
      path: options.pathFor?.(reading.id, drawn, reading.at) ?? null,
      start: now,
      duration: clamp(elapsed, MIN_GLIDE_MS, MAX_GLIDE_MS),
      seenAt: now,
    });
  }
  return tracks;
}
