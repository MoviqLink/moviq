/**
 * Trips grouped into patterns, the routes of RAPTOR: trips of one route and service that call at
 * the same stops in the same order and never overtake one another, so the latest trip at one stop
 * is the latest at all of them. Everything lands in flat typed arrays.
 */

/** A trip ready to be placed: stop indexes, `[arrival, departure]` pairs and boarding flags. */
export interface TripDraft {
  readonly id: string;
  readonly route: number;
  readonly service: number;
  readonly feed: number;
  readonly headsign: string | null;
  readonly stops: Int32Array;
  readonly times: Int32Array;
  readonly flags: Uint8Array;
}

export interface PatternTable {
  readonly count: number;
  readonly route: Int32Array;
  readonly service: Int32Array;
  readonly feed: Uint8Array;
  /** Pattern `p` calls at `stops[stopsStart[p]..stopsStart[p + 1]]`. */
  readonly stopsStart: Int32Array;
  readonly stops: Int32Array;
  /** Its trips are `tripsStart[p]..tripsStart[p + 1]`, earliest first. */
  readonly tripsStart: Int32Array;
}

export interface TripTable {
  readonly ids: readonly string[];
  readonly headsigns: readonly (string | null)[];
  readonly pattern: Int32Array;
  /** Trip `t` at position `i` arrives at `times[timesStart[t] + 2i]`, departs one later. */
  readonly timesStart: Int32Array;
  /** One per stop time, at `timesStart[t] / 2 + i`. */
  readonly flags: Uint8Array;
  readonly times: Int32Array;
}

function groupKey(trip: TripDraft): string {
  return `${String(trip.feed)}|${String(trip.route)}|${String(trip.service)}|${trip.stops.join(',')}`;
}

function byFirstDeparture(a: TripDraft, b: TripDraft): number {
  const first = (a.times[1] ?? 0) - (b.times[1] ?? 0);
  if (first !== 0) return first;
  const last = (a.times.at(-2) ?? 0) - (b.times.at(-2) ?? 0);
  if (last !== 0) return last;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** True when `later` is at or after `earlier` at every stop, arriving and departing. */
function neverOvertakes(earlier: TripDraft, later: TripDraft): boolean {
  for (let at = 0; at < later.times.length; at += 1) {
    if ((later.times[at] ?? 0) < (earlier.times[at] ?? 0)) return false;
  }
  return true;
}

/** Splits trips of one stop sequence into the fewest first-fit groups that keep FIFO order. */
function splitFifo(trips: readonly TripDraft[]): TripDraft[][] {
  const groups: TripDraft[][] = [];
  for (const trip of [...trips].sort(byFirstDeparture)) {
    const fits = groups.find((group) => {
      const last = group.at(-1);
      return last !== undefined && neverOvertakes(last, trip);
    });
    if (fits) fits.push(trip);
    else groups.push([trip]);
  }
  return groups;
}

/** Groups in a stable order: by key, then by first-fit order within a key. */
function orderedGroups(trips: readonly TripDraft[]): TripDraft[][] {
  const byKey = new Map<string, TripDraft[]>();
  for (const trip of trips) {
    const key = groupKey(trip);
    const group = byKey.get(key);
    if (group) group.push(trip);
    else byKey.set(key, [trip]);
  }
  return [...byKey.keys()].sort().flatMap((key) => splitFifo(byKey.get(key) ?? []));
}

export function buildPatterns(trips: readonly TripDraft[]): {
  readonly patterns: PatternTable;
  readonly trips: TripTable;
} {
  const groups = orderedGroups(trips);
  const stopCount = groups.reduce((total, group) => total + (group[0]?.stops.length ?? 0), 0);
  const timeCount = trips.reduce((total, trip) => total + trip.times.length, 0);
  const patterns = {
    count: groups.length,
    route: new Int32Array(groups.length),
    service: new Int32Array(groups.length),
    feed: new Uint8Array(groups.length),
    stopsStart: new Int32Array(groups.length + 1),
    stops: new Int32Array(stopCount),
    tripsStart: new Int32Array(groups.length + 1),
  };
  const table = {
    ids: [] as string[],
    headsigns: [] as (string | null)[],
    pattern: new Int32Array(trips.length),
    timesStart: new Int32Array(trips.length),
    flags: new Uint8Array(timeCount / 2),
    times: new Int32Array(timeCount),
  };
  let stopAt = 0;
  let timeAt = 0;
  for (const [index, group] of groups.entries()) {
    const first = group[0];
    if (first === undefined) continue;
    patterns.route[index] = first.route;
    patterns.service[index] = first.service;
    patterns.feed[index] = first.feed;
    patterns.stops.set(first.stops, stopAt);
    stopAt += first.stops.length;
    patterns.stopsStart[index + 1] = stopAt;
    for (const trip of group) {
      const tripIndex = table.ids.length;
      table.ids.push(trip.id);
      table.headsigns.push(trip.headsign);
      table.pattern[tripIndex] = index;
      table.timesStart[tripIndex] = timeAt;
      table.times.set(trip.times, timeAt);
      table.flags.set(trip.flags, timeAt / 2);
      timeAt += trip.times.length;
    }
    patterns.tripsStart[index + 1] = table.ids.length;
  }
  return { patterns, trips: table };
}

/** Stop to patterns, with the position of the stop in each, as flat arrays by stop. */
export interface StopPatterns {
  readonly start: Int32Array;
  readonly pattern: Int32Array;
  readonly position: Int32Array;
}

export function indexStopPatterns(patterns: PatternTable, stopCount: number): StopPatterns {
  const start = new Int32Array(stopCount + 1);
  for (const stop of patterns.stops) start[stop + 1] = (start[stop + 1] ?? 0) + 1;
  for (let stop = 0; stop < stopCount; stop += 1) {
    start[stop + 1] = (start[stop + 1] ?? 0) + (start[stop] ?? 0);
  }
  const fill = start.slice(0, stopCount);
  const pattern = new Int32Array(patterns.stops.length);
  const position = new Int32Array(patterns.stops.length);
  for (let index = 0; index < patterns.count; index += 1) {
    const from = patterns.stopsStart[index] ?? 0;
    const to = patterns.stopsStart[index + 1] ?? 0;
    for (let at = from; at < to; at += 1) {
      const stop = patterns.stops[at] ?? 0;
      const slot = fill[stop] ?? 0;
      pattern[slot] = index;
      position[slot] = at - from;
      fill[stop] = slot + 1;
    }
  }
  return { start, pattern, position };
}
