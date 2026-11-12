import type { Place } from '@moviq/contracts';

import type { EntrancePoint, TimetableInput } from './inputs.js';
import { distanceMetres, walkSeconds } from './walking.js';

/**
 * How far a step-free entrance may lie from its station's point, so the stops a walk can reach
 * through one are found: the 113 elevators and ramps of the survey sit within 150 m of their
 * station in `stops.txt` (11/11/2026); twice that leaves room for new ones.
 */
export const ENTRANCE_REACH_M = 300;

/** The step-free entrances of each served stop, those of its station, in flat arrays. */
export interface StopEntrances {
  /** Entrances of stop `s` are `start[s]..start[s + 1]`. */
  readonly start: Int32Array;
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** 1 where the entrance lets people in (`entry`), and out (`exit`). */
  readonly entry: Uint8Array;
  readonly exit: Uint8Array;
}

interface ServedStop {
  readonly feed: number;
  readonly id: string;
}

/** Each served stop with the step-free entrances its timetable lists for its station. */
export function compileEntrances(
  feeds: readonly { readonly timetable: TimetableInput }[],
  stops: readonly ServedStop[],
): StopEntrances {
  const start = new Int32Array(stops.length + 1);
  const points: EntrancePoint[] = [];
  for (const [at, { feed, id }] of stops.entries()) {
    const timetable = feeds[feed]?.timetable;
    const station = timetable?.stops[id]?.parent ?? id;
    points.push(...(timetable?.entrances[station] ?? []));
    start[at + 1] = points.length;
  }
  return {
    start,
    lat: Float64Array.from(points, (point) => point.lat),
    lon: Float64Array.from(points, (point) => point.lon),
    entry: Uint8Array.from(points, (point) => (point.entry ? 1 : 0)),
    exit: Uint8Array.from(points, (point) => (point.exit ? 1 : 0)),
  };
}

/** Whether the survey lists a step-free entrance for the station of a stop. */
export function listsEntrances(entrances: StopEntrances, stop: number): boolean {
  return (entrances.start[stop + 1] ?? 0) > (entrances.start[stop] ?? 0);
}

/** A walk through a step-free entrance: its estimated seconds and the entrance walked to. */
interface EntranceWalk {
  readonly seconds: number;
  readonly lat: number;
  readonly lon: number;
}

/**
 * The walk between a place and a stop through its nearest step-free entrance that lets people
 * in (`entry`, to board) or out (`exit`, at the end), or undefined when none does. The walk
 * inside the station, from the entrance to the platform, is not counted.
 */
export function entranceWalk(
  entrances: StopEntrances,
  stop: number,
  place: Place,
  use: 'entry' | 'exit',
): EntranceWalk | undefined {
  const allowed = use === 'entry' ? entrances.entry : entrances.exit;
  let best: EntranceWalk | undefined;
  for (let at = entrances.start[stop] ?? 0; at < (entrances.start[stop + 1] ?? 0); at += 1) {
    if (allowed[at] !== 1) continue;
    const lat = entrances.lat[at] ?? 0;
    const lon = entrances.lon[at] ?? 0;
    const seconds = walkSeconds(distanceMetres(place.lat, place.lon, lat, lon));
    if (best === undefined || seconds < best.seconds) best = { seconds, lat, lon };
  }
  return best;
}
