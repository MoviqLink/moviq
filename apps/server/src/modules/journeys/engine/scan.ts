import { round, tryBoard, usable, type Run } from './labels.js';
import { NONE } from './live.js';
import { NO_DROP_OFF, NO_PICKUP } from './inputs.js';

/**
 * The route scan of a backward RAPTOR round. A pattern is walked from its last marked stop back
 * to its first: at each stop the current trip is boarded, then a later trip is taken if it can
 * be left there in time. Of the stops where the same trip can be left, the one with the most
 * time to spare before the next ride is kept, so changes are as robust as the timetable allows.
 */

/** The latest timetable trip of a pattern arriving at `position` by `limit`, from `lowest` up. */
function latestArriving(
  run: Run,
  pattern: number,
  position: number,
  limit: number,
  day: number,
  lowest: number,
): number {
  const { trips, patterns } = run.request.network;
  let low = patterns.tripsStart[pattern] ?? 0;
  let high = (patterns.tripsStart[pattern + 1] ?? 0) - 1;
  let found = low - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if ((trips.times[(trips.timesStart[middle] ?? 0) + 2 * position] ?? 0) <= limit) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const tripCount = trips.ids.length;
  const floor = Math.max(lowest, patterns.tripsStart[pattern] ?? 0);
  for (; found >= floor; found -= 1) {
    const flags = trips.flags[(trips.timesStart[found] ?? 0) / 2 + position] ?? 0;
    const replaced = run.request.overlay.replaced.has(day * tripCount + found);
    if (!replaced && (flags & NO_DROP_OFF) === 0) return found;
  }
  return -1;
}

/** The trip being ridden backwards: where it is left and how much time that leaves. */
interface Current {
  trip: number;
  alightAt: number;
  spare: number;
}

function scanTimetable(run: Run, k: number, pattern: number, day: number, last: number): void {
  const { network, calendar } = run.request;
  const offset = calendar.days[day]?.offset ?? 0;
  const first = network.patterns.stopsStart[pattern] ?? 0;
  const alight = round(run.labels.alight, k - 1);
  const ride = (trip: number): number => day * network.trips.ids.length + trip;
  const current: Current = { trip: -1, alightAt: -1, spare: 0 };
  for (let position = last; position >= 0; position -= 1) {
    const stop = network.patterns.stops[first + position] ?? 0;
    if (!usable(run.request, stop)) continue;
    if (current.trip >= 0) {
      const at = (network.trips.timesStart[current.trip] ?? 0) + 2 * position;
      if (((network.trips.flags[at / 2] ?? 0) & NO_PICKUP) === 0) {
        const departure = offset + (network.trips.times[at + 1] ?? 0);
        const boarding = { ride: ride(current.trip), from: position, to: current.alightAt };
        tryBoard(run, k, stop, departure, boarding);
      }
    }
    const limit = alight[stop] ?? NONE;
    if (limit === NONE) continue;
    const trip = latestArriving(run, pattern, position, limit - offset, day, current.trip);
    if (trip < 0) continue;
    const arrival =
      offset + (network.trips.times[(network.trips.timesStart[trip] ?? 0) + 2 * position] ?? 0);
    if (trip > current.trip || limit - arrival > current.spare) {
      current.trip = trip;
      current.alightAt = position;
      current.spare = limit - arrival;
    }
  }
}

function scanLive(run: Run, k: number, instance: number, last: number): void {
  const { network, overlay } = run.request;
  const live = overlay.instances[instance];
  if (live === undefined) return;
  const first = network.patterns.stopsStart[network.trips.pattern[live.trip] ?? 0] ?? 0;
  const flagsAt = (network.trips.timesStart[live.trip] ?? 0) / 2;
  const alight = round(run.labels.alight, k - 1);
  const current: Current = { trip: live.trip, alightAt: -1, spare: 0 };
  for (let position = last; position >= 0; position -= 1) {
    const stop = network.patterns.stops[first + position] ?? 0;
    const flags = network.trips.flags[flagsAt + position] ?? 0;
    if (!usable(run.request, stop)) continue;
    const departure = live.times[2 * position + 1] ?? NONE;
    if (current.alightAt >= 0 && departure !== NONE && (flags & NO_PICKUP) === 0) {
      tryBoard(run, k, stop, departure, {
        ride: -(instance + 1),
        from: position,
        to: current.alightAt,
      });
    }
    const arrival = live.times[2 * position] ?? NONE;
    const limit = alight[stop] ?? NONE;
    if (arrival === NONE || limit === NONE || arrival > limit || (flags & NO_DROP_OFF) !== 0)
      continue;
    if (current.alightAt < 0 || limit - arrival > current.spare) {
      current.alightAt = position;
      current.spare = limit - arrival;
    }
  }
}

/** The patterns through the stops marked, each with the last position to scan back from. */
function patternsToScan(run: Run, marked: readonly number[]): Map<number, number> {
  const { stopPatterns } = run.request.network;
  const last = new Map<number, number>();
  for (const stop of marked) {
    for (
      let at = stopPatterns.start[stop] ?? 0;
      at < (stopPatterns.start[stop + 1] ?? 0);
      at += 1
    ) {
      const pattern = stopPatterns.pattern[at] ?? 0;
      if (run.request.patterns[pattern] !== 1) continue;
      const position = stopPatterns.position[at] ?? 0;
      if ((last.get(pattern) ?? -1) < position) last.set(pattern, position);
    }
  }
  return last;
}

/** Scans every pattern through a marked stop, on each service day it runs, then its live trips. */
export function scanRound(run: Run, k: number, marked: readonly number[]): void {
  const { network, calendar, overlay } = run.request;
  const toScan = patternsToScan(run, marked);
  for (const pattern of [...toScan.keys()].sort((a, b) => a - b)) {
    const last = toScan.get(pattern) ?? 0;
    const service = network.patterns.service[pattern] ?? 0;
    for (const [day, serviceDay] of calendar.days.entries()) {
      if (serviceDay.running[service] === 1) scanTimetable(run, k, pattern, day, last);
    }
    for (const instance of overlay.byPattern.get(pattern) ?? []) scanLive(run, k, instance, last);
  }
}
