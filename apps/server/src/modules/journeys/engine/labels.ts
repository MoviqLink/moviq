import type { Footpaths } from './footpaths.js';
import { NONE, type LiveOverlay } from './live.js';
import type { Network } from './network.js';
import type { SearchCalendar } from './service-days.js';

export interface StopWalk {
  readonly stop: number;
  readonly seconds: number;
}

export interface SearchRequest {
  readonly network: Network;
  readonly calendar: SearchCalendar;
  readonly overlay: LiveOverlay;
  /** 1 for patterns of the modes asked for. */
  readonly patterns: Uint8Array;
  /** 1 for stops that may be used; null when every stop may. */
  readonly stops: Uint8Array | null;
  /** The transfers this search may use: all of them, or the step-free ones. */
  readonly footpaths: Footpaths;
  readonly access: readonly StopWalk[];
  readonly egress: readonly StopWalk[];
  /** Search seconds: arrive no later than `deadline`, leave no earlier than `earliest`. */
  readonly deadline: number;
  readonly earliest: number;
  readonly maxRides: number;
}

/** Labels by round: `board[k]` and its ride, `alight[k]` and the transfer that sets it. */
export interface Labels {
  readonly board: Int32Array[];
  readonly alight: Int32Array[];
  /** `day * trips + trip` for a timetable trip, `-(instance + 1)` for a live one. */
  readonly ride: Int32Array[];
  readonly boardAt: Int32Array[];
  readonly alightAt: Int32Array[];
  readonly transferTo: Int32Array[];
  readonly transferSeconds: Int32Array[];
}

export interface FrontEntry {
  readonly rides: number;
  readonly accessStop: number;
  readonly departure: number;
}

/** The state of one search: its labels, the best of every round so far and the marks. */
export interface Run {
  readonly request: SearchRequest;
  readonly labels: Labels;
  readonly bestBoard: Int32Array;
  readonly bestAlight: Int32Array;
  readonly improved: Uint8Array;
  bestOrigin: number;
}

function filled(count: number, value: number): Int32Array {
  return new Int32Array(count).fill(value);
}

export function createRun(request: SearchRequest): Run {
  const stops = request.network.stops.count;
  const each = (value: number): Int32Array[] =>
    Array.from({ length: request.maxRides + 1 }, () => filled(stops, value));
  return {
    request,
    labels: {
      board: each(NONE),
      alight: each(NONE),
      ride: each(0),
      boardAt: each(-1),
      alightAt: each(-1),
      transferTo: each(-1),
      transferSeconds: each(0),
    },
    bestBoard: filled(stops, NONE),
    bestAlight: filled(stops, NONE),
    improved: new Uint8Array(stops),
    bestOrigin: NONE,
  };
}

export function round<T>(list: readonly T[], k: number): T {
  const value = list[k];
  if (value === undefined) throw new RangeError(`round ${String(k)} is outside the search`);
  return value;
}

export function usable(request: SearchRequest, stop: number): boolean {
  return request.stops === null || request.stops[stop] === 1;
}

/** One ride boarded at `stop`: the trip, where it is boarded and where it is left. */
export interface Boarding {
  readonly ride: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Keeps a boarding time when it beats every round so far, the best origin departure and the
 * earliest time allowed: a later round must leave strictly later to be on the front.
 */
export function tryBoard(
  run: Run,
  k: number,
  stop: number,
  time: number,
  boarding: Boarding,
): void {
  if (time < run.request.earliest || time <= run.bestOrigin) return;
  if (time <= (run.bestBoard[stop] ?? NONE)) return;
  round(run.labels.board, k)[stop] = time;
  round(run.labels.ride, k)[stop] = boarding.ride;
  round(run.labels.boardAt, k)[stop] = boarding.from;
  round(run.labels.alightAt, k)[stop] = boarding.to;
  run.bestBoard[stop] = time;
  run.improved[stop] = 1;
}

/** Takes the stops marked, in stop order, and clears the marks. */
export function takeImproved(run: Run): number[] {
  const stops: number[] = [];
  for (let stop = 0; stop < run.improved.length; stop += 1) {
    if (run.improved[stop] === 1) stops.push(stop);
  }
  run.improved.fill(0);
  return stops;
}
