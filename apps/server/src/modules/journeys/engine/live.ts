import { feedKey } from './feed-key.js';
import type { LivePredictions, LiveTrip } from './inputs.js';
import type { Network } from './network.js';
import type { SearchCalendar } from './service-days.js';

/** A time no label has: unreachable, or a stop a live trip has passed or does not confirm. */
export const NONE = -2_147_483_648;

/** A trip on one service day with the times its live prediction gives, in search seconds. */
interface LiveInstance {
  readonly trip: number;
  readonly day: number;
  /** `[arrival, departure]` per position; `NONE` where the prediction says nothing. */
  readonly times: Int32Array;
}

export interface LiveOverlay {
  /** `day * trips + trip` of trips the timetable must not be used for: cancelled or live. */
  readonly replaced: ReadonlySet<number>;
  readonly instances: readonly LiveInstance[];
  /** Live instances of each pattern, by index into `instances`. */
  readonly byPattern: ReadonlyMap<number, readonly number[]>;
  readonly counts: { readonly live: number; readonly cancelled: number };
}

/** `115550_1..N` from `115550_1..N03R`: origin time, route and direction of a subway trip. */
function subwayShortId(id: string): string {
  return /^\d+_[A-Za-z0-9]+\.{1,2}[NS]/.exec(id)?.[0] ?? id;
}

function subwayCore(staticId: string): string {
  const at = staticId.indexOf('_');
  return at < 0 ? staticId : staticId.slice(at + 1);
}

const subwayIndexes = new WeakMap<Network, Map<string, number[]>>();

function subwayIndex(network: Network): Map<string, number[]> {
  const cached = subwayIndexes.get(network);
  if (cached) return cached;
  const index = new Map<string, number[]>();
  for (const [trip, id] of network.trips.ids.entries()) {
    const feed = network.patterns.feed[network.trips.pattern[trip] ?? 0] ?? 0;
    const key = feedKey(feed, subwayShortId(subwayCore(id)));
    const list = index.get(key);
    if (list) list.push(trip);
    else index.set(key, [trip]);
  }
  subwayIndexes.set(network, index);
  return index;
}

function candidates(
  network: Network,
  feeds: readonly number[],
  live: LivePredictions,
  id: string,
): number[] {
  if (live.rule === 'exact') {
    return feeds.flatMap((feed) => {
      const trip = network.tripByKey.get(feedKey(feed, id));
      return trip === undefined ? [] : [trip];
    });
  }
  const short = subwayShortId(id);
  const found = feeds.flatMap((feed) => subwayIndex(network).get(feedKey(feed, short)) ?? []);
  return short === id
    ? found
    : found.filter((trip) => subwayCore(network.trips.ids[trip] ?? '') === id);
}

/** The one trip and service day a live trip is, or undefined when none or several fit. */
function matchTrip(
  network: Network,
  calendar: SearchCalendar,
  feeds: readonly number[],
  live: LivePredictions,
  trip: LiveTrip,
): { readonly trip: number; readonly day: number } | undefined {
  const fits: { trip: number; day: number }[] = [];
  for (const candidate of candidates(network, feeds, live, trip.tripId)) {
    const service = network.patterns.service[network.trips.pattern[candidate] ?? 0] ?? 0;
    for (const [day, serviceDay] of calendar.days.entries()) {
      if (trip.startDate !== null && serviceDay.date !== trip.startDate) continue;
      if (serviceDay.running[service] === 1) fits.push({ trip: candidate, day });
    }
  }
  return fits.length === 1 ? fits[0] : undefined;
}

/** A predicted time is used only within the two service days searched and the one after. */
const PREDICTION_SPAN_SECONDS = 3 * 86_400;

function searchSeconds(instant: string | null, epochMs: number): number | undefined {
  if (instant === null) return undefined;
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return undefined;
  const seconds = Math.round((ms - epochMs) / 1000);
  return seconds >= 0 && seconds <= PREDICTION_SPAN_SECONDS ? seconds : undefined;
}

/**
 * Live times along the trip's stops: predicted stops are matched in travel order; stops before
 * the first one are passed and the ones the prediction leaves out are not confirmed, so neither
 * can be used. A time going back is not used either.
 */
function liveTimes(
  network: Network,
  trip: number,
  live: LiveTrip,
  epochMs: number,
): Int32Array | undefined {
  const pattern = network.trips.pattern[trip] ?? 0;
  const from = network.patterns.stopsStart[pattern] ?? 0;
  const count = (network.patterns.stopsStart[pattern + 1] ?? 0) - from;
  const times = new Int32Array(count * 2).fill(NONE);
  let position = 0;
  let previous = Number.NEGATIVE_INFINITY;
  let matched = 0;
  for (const stop of live.stops) {
    let at = position;
    while (at < count && network.stops.ids[network.patterns.stops[from + at] ?? 0] !== stop.stopId)
      at += 1;
    if (at === count) continue;
    position = at + 1;
    const arrival = searchSeconds(stop.arrival ?? stop.departure, epochMs);
    const departure = searchSeconds(stop.departure ?? stop.arrival, epochMs);
    if (arrival === undefined || departure === undefined) continue;
    const latest = Math.max(arrival, departure);
    if (arrival < previous) continue;
    times[2 * at] = arrival;
    times[2 * at + 1] = latest;
    previous = latest;
    matched += 1;
  }
  return matched === 0 ? undefined : times;
}

/** What the live feeds change in the timetable for this search. */
export function buildOverlay(
  network: Network,
  calendar: SearchCalendar,
  feeds: readonly LivePredictions[],
): LiveOverlay {
  const replaced = new Set<number>();
  const instances: LiveInstance[] = [];
  const byPattern = new Map<number, number[]>();
  let cancelled = 0;
  const tripCount = network.trips.ids.length;
  for (const predictions of feeds) {
    const feeds = network.feeds.flatMap((feed, index) =>
      predictions.timetables.includes(feed.sourceId) ? [index] : [],
    );
    for (const liveTrip of predictions.trips) {
      const match = matchTrip(network, calendar, feeds, predictions, liveTrip);
      if (match === undefined) continue;
      const code = match.day * tripCount + match.trip;
      if (replaced.has(code)) continue;
      if (liveTrip.cancelled) {
        replaced.add(code);
        cancelled += 1;
        continue;
      }
      const times = liveTimes(network, match.trip, liveTrip, calendar.epochMs);
      if (times === undefined) continue;
      replaced.add(code);
      const pattern = network.trips.pattern[match.trip] ?? 0;
      const list = byPattern.get(pattern);
      if (list) list.push(instances.length);
      else byPattern.set(pattern, [instances.length]);
      instances.push({ trip: match.trip, day: match.day, times });
    }
  }
  return { replaced, instances, byPattern, counts: { live: instances.length, cancelled } };
}
