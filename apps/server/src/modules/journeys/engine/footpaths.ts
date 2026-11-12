import { nearbyStops, type StopGrid } from './grid.js';
import type { GtfsTransfer } from './inputs.js';
import {
  SAME_STOP_CHANGE_SECONDS,
  TRANSFER_RADIUS_M,
  distanceMetres,
  walkSeconds,
} from './walking.js';

/**
 * Transfers as RAPTOR reads them backwards: for each stop where the next ride is boarded, the
 * stops where the previous ride may end, with the seconds to change. A stop always reaches
 * itself, with the time to change vehicles there.
 */
export interface Footpaths {
  readonly start: Int32Array;
  /** The stop alighted at; edges of boarding stop `p` are `start[p]..start[p + 1]`. */
  readonly from: Int32Array;
  readonly seconds: Int32Array;
  /** 1 where the edge's time is a `transfers.txt` rule's, so no walk on the streets is asked. */
  readonly ruled: Uint8Array;
}

interface StopPlaces {
  readonly lat: Float64Array;
  readonly lon: Float64Array;
}

/** The served stops a `transfers.txt` id names in its feed: the stop itself or a station's own. */
type StopsNamed = (feed: number, gtfsId: string) => readonly number[];

/** What a step-free change needs: both stops accessible, both ends of its rule in one complex. */
interface StepFreeChanges {
  readonly accessible: Uint8Array;
  readonly sameComplex: (feed: number, from: string, to: string) => boolean;
}

const FORBIDDEN = -1;
/** A rule that allows the transfer without a minimum time: the walk decides. */
const NO_MINIMUM = -2;

/** Seconds by `from * count + to`, or one of the two markers above. */
function ruleSeconds(
  rules: readonly (readonly GtfsTransfer[])[],
  count: number,
  named: StopsNamed,
): Map<number, number> {
  const seconds = new Map<number, number>();
  for (const [feed, transfers] of rules.entries()) {
    for (const rule of transfers) {
      for (const from of named(feed, rule.from)) {
        for (const to of named(feed, rule.to)) {
          seconds.set(
            from * count + to,
            rule.type === 3 ? FORBIDDEN : (rule.minSeconds ?? NO_MINIMUM),
          );
        }
      }
    }
  }
  return seconds;
}

/** Boarding stop to the alighting stops its rules name, so each stop looks only at its own. */
function ruledInto(rules: Map<number, number>, count: number): Map<number, number[]> {
  const into = new Map<number, number[]>();
  for (const key of rules.keys()) {
    const to = key % count;
    const from = (key - to) / count;
    const list = into.get(to);
    if (list) list.push(from);
    else into.set(to, [from]);
  }
  return into;
}

function walkBetween(stops: StopPlaces, from: number, to: number): number {
  if (from === to) return SAME_STOP_CHANGE_SECONDS;
  const metres = distanceMetres(
    stops.lat[from] ?? 0,
    stops.lon[from] ?? 0,
    stops.lat[to] ?? 0,
    stops.lon[to] ?? 0,
  );
  return Math.max(SAME_STOP_CHANGE_SECONDS, walkSeconds(metres));
}

interface RulesInto {
  readonly seconds: Map<number, number>;
  readonly from: readonly number[];
  /** The time of a rule without a minimum where no walk was found. */
  readonly noMinimum: (from: number) => number;
}

/** The edges into one boarding stop: seconds by stop alighted at, and those a rule timed. */
interface EdgesInto {
  readonly seconds: Map<number, number>;
  readonly ruled: Set<number>;
}

/**
 * The rules into one boarding stop over the seconds found so far (type 3 removes the change). A
 * rule with a minimum time is the station's own change; one without keeps a walk found nearby,
 * and where there is none its time is the station's (the change is inside it).
 */
function applyRules(edges: EdgesInto, to: number, count: number, rules: RulesInto): void {
  const { seconds, ruled } = edges;
  for (const from of rules.from) {
    const rule = rules.seconds.get(from * count + to);
    if (rule === undefined) continue;
    if (rule === FORBIDDEN) {
      seconds.delete(from);
    } else if (rule !== NO_MINIMUM) {
      seconds.set(from, rule);
      ruled.add(from);
    } else if (!seconds.has(from)) {
      seconds.set(from, rules.noMinimum(from));
      ruled.add(from);
    }
  }
}

/** Edges into every stop in flat arrays, each stop's sorted by the stop alighted at. */
function assemble(count: number, into: (to: number) => EdgesInto): Footpaths {
  const start = new Int32Array(count + 1);
  const from: number[] = [];
  const seconds: number[] = [];
  const ruled: number[] = [];
  for (let to = 0; to < count; to += 1) {
    const edges = into(to);
    for (const [stop, value] of [...edges.seconds].sort((a, b) => a[0] - b[0])) {
      from.push(stop);
      seconds.push(value);
      ruled.push(edges.ruled.has(stop) ? 1 : 0);
    }
    start[to + 1] = from.length;
  }
  return {
    start,
    from: Int32Array.from(from),
    seconds: Int32Array.from(seconds),
    ruled: Uint8Array.from(ruled),
  };
}

/** Every transfer: nearby stops on foot, then the `transfers.txt` rules over them. */
export function buildFootpaths(
  stops: StopPlaces,
  grid: StopGrid,
  transfers: readonly (readonly GtfsTransfer[])[],
  named: StopsNamed,
): Footpaths {
  const count = stops.lat.length;
  const rules = ruleSeconds(transfers, count, named);
  const ruled = ruledInto(rules, count);
  return assemble(count, (to) => {
    const seconds = new Map<number, number>();
    const point = { lat: stops.lat[to] ?? 0, lon: stops.lon[to] ?? 0 };
    for (const near of nearbyStops(grid, stops, point, TRANSFER_RADIUS_M)) {
      seconds.set(near.stop, Math.max(SAME_STOP_CHANGE_SECONDS, walkSeconds(near.metres)));
    }
    seconds.set(to, SAME_STOP_CHANGE_SECONDS);
    const edges = { seconds, ruled: new Set<number>() };
    applyRules(edges, to, count, {
      seconds: rules,
      from: ruled.get(to) ?? [],
      noMinimum: () => SAME_STOP_CHANGE_SECONDS,
    });
    return edges;
  });
}

/**
 * Transfers for a step-free trip. Without a graph of the inside of stations (the MTA files have
 * no `pathways.txt` or `levels.txt`), no change is walked from coordinates: platforms of one
 * station share a point, and leaving one may mean crossing the street (the L at 1 Av). Only the
 * same stop and the `transfers.txt` rules between accessible stops of one complex are kept, at
 * their times; none of them is verified step-free inside the station.
 */
export function buildStepFreeFootpaths(
  stops: StopPlaces,
  transfers: readonly (readonly GtfsTransfer[])[],
  named: StopsNamed,
  changes: StepFreeChanges,
): Footpaths {
  const count = stops.lat.length;
  const inComplex = transfers.map((rules, feed) =>
    rules.filter((rule) => changes.sameComplex(feed, rule.from, rule.to)),
  );
  const rules = ruleSeconds(inComplex, count, named);
  const ruled = ruledInto(rules, count);
  const accessible = (stop: number): boolean => changes.accessible[stop] === 1;
  return assemble(count, (to) => {
    const edges = {
      seconds: new Map<number, number>([[to, SAME_STOP_CHANGE_SECONDS]]),
      ruled: new Set<number>(),
    };
    if (!accessible(to)) return edges;
    const from = (ruled.get(to) ?? []).filter(accessible);
    const noMinimum = (stop: number): number => walkBetween(stops, stop, to);
    applyRules(edges, to, count, { seconds: rules, from, noMinimum });
    return edges;
  });
}

/** The edges whose mark in `kept` is 1, every stop's edges still in order. */
function keptEdges(footpaths: Footpaths, seconds: Int32Array, kept: Uint8Array): Footpaths {
  const count = footpaths.start.length - 1;
  const start = new Int32Array(count + 1);
  const at: number[] = [];
  for (let to = 0; to < count; to += 1) {
    start[to] = at.length;
    for (let edge = footpaths.start[to] ?? 0; edge < (footpaths.start[to + 1] ?? 0); edge += 1) {
      if (kept[edge] === 1) at.push(edge);
    }
  }
  start[count] = at.length;
  return {
    start,
    from: Int32Array.from(at, (edge) => footpaths.from[edge] ?? 0),
    seconds: Int32Array.from(at, (edge) => seconds[edge] ?? 0),
    ruled: Uint8Array.from(at, (edge) => footpaths.ruled[edge] ?? 0),
  };
}

/**
 * The same transfers with the street times known for some changes (`from * count + to`), at
 * least the time to change vehicles, and without the changes the streets have no way for (a
 * time that is not finite); a copy, so the compiled network stays as it is.
 */
export function withChangeTimes(
  footpaths: Footpaths,
  times: ReadonlyMap<number, number>,
): Footpaths {
  if (times.size === 0) return footpaths;
  const count = footpaths.start.length - 1;
  const seconds = Int32Array.from(footpaths.seconds);
  const kept = new Uint8Array(seconds.length).fill(1);
  for (const [key, walked] of times) {
    const to = key % count;
    const from = (key - to) / count;
    for (let at = footpaths.start[to] ?? 0; at < (footpaths.start[to + 1] ?? 0); at += 1) {
      if (footpaths.from[at] !== from) continue;
      if (Number.isFinite(walked)) seconds[at] = Math.max(SAME_STOP_CHANGE_SECONDS, walked);
      else kept[at] = 0;
    }
  }
  return kept.includes(0) ? keptEdges(footpaths, seconds, kept) : { ...footpaths, seconds };
}
