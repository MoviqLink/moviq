import { feedKey } from './feed-key.js';
import type { StopTimeColumns, TimetableInput } from './inputs.js';
import type { TripDraft } from './patterns.js';

interface FeedTables {
  readonly timetable: TimetableInput;
}

interface Indexes {
  readonly stops: ReadonlyMap<string, number>;
  readonly routes: ReadonlyMap<string, number>;
  readonly services: ReadonlyMap<string, number>;
}

/** Why a trip of a timetable is not part of the network; none of these is guessed around. */
type LeftOutReason =
  | 'trip without stop times'
  | 'stop times of an unknown trip'
  | 'stop times given twice for a trip'
  | 'trip on a route not followed'
  | 'trip with an unknown service'
  | 'trip calling at a stop left out'
  | 'trip with inconsistent times';

/** The calls of one trip: `from..to` in the columns. */
interface Range {
  readonly from: number;
  readonly to: number;
}

/** True when the calls can be ridden: two or more, never going back, leaving after arriving. */
function consistent(columns: StopTimeColumns, range: Range): boolean {
  if (range.to - range.from < 2 || range.from < 0 || range.to > columns.stop.length) return false;
  let previous = Number.NEGATIVE_INFINITY;
  for (let at = range.from; at < range.to; at += 1) {
    const arrival = columns.arrival[at] ?? Number.NaN;
    const departure = columns.departure[at] ?? Number.NaN;
    if (!(arrival >= previous && departure >= arrival)) return false;
    previous = departure;
  }
  return true;
}

function packTimes(columns: StopTimeColumns, range: Range): Int32Array {
  const packed = new Int32Array((range.to - range.from) * 2);
  for (let at = range.from; at < range.to; at += 1) {
    packed[2 * (at - range.from)] = columns.arrival[at] ?? 0;
    packed[2 * (at - range.from) + 1] = columns.departure[at] ?? 0;
  }
  return packed;
}

function stopIndexes(
  feed: number,
  columns: StopTimeColumns,
  range: Range,
  index: Indexes,
): Int32Array | undefined {
  const indexes = new Int32Array(range.to - range.from);
  for (let at = range.from; at < range.to; at += 1) {
    const id = columns.stops[columns.stop[at] ?? -1];
    const stop = id === undefined ? undefined : index.stops.get(feedKey(feed, id));
    if (stop === undefined) return undefined;
    indexes[at - range.from] = stop;
  }
  return indexes;
}

/** The call range of each trip in the columns; a trip listed twice has none. */
function rangesOf(columns: StopTimeColumns): Map<string, Range | 'twice'> {
  const ranges = new Map<string, Range | 'twice'>();
  for (const [trip, id] of columns.trips.entries()) {
    const range = { from: columns.tripStart[trip] ?? 0, to: columns.tripStart[trip + 1] ?? 0 };
    ranges.set(id, ranges.has(id) ? 'twice' : range);
  }
  return ranges;
}

/** One trip as a draft, or why it is left out. */
function draftOf(
  feed: number,
  tripId: string,
  timetable: TimetableInput,
  range: Range | 'twice' | undefined,
  index: Indexes,
): TripDraft | LeftOutReason {
  const trip = timetable.trips[tripId];
  if (trip === undefined) return 'stop times of an unknown trip';
  if (range === undefined) return 'trip without stop times';
  if (range === 'twice') return 'stop times given twice for a trip';
  const route = index.routes.get(feedKey(feed, trip.route));
  if (route === undefined) return 'trip on a route not followed';
  const service = index.services.get(feedKey(feed, trip.service));
  if (service === undefined) return 'trip with an unknown service';
  const columns = timetable.stopTimes;
  if (!consistent(columns, range)) return 'trip with inconsistent times';
  const stops = stopIndexes(feed, columns, range, index);
  if (stops === undefined) return 'trip calling at a stop left out';
  const times = packTimes(columns, range);
  const flags = columns.flags.slice(range.from, range.to);
  return { id: tripId, route, service, feed, headsign: trip.headsign, stops, times, flags };
}

/** Every trip of every feed as a draft, by feed then trip id, with what was left out. */
export function draftTrips(
  feeds: readonly FeedTables[],
  index: Indexes,
): { readonly trips: TripDraft[]; readonly leftOut: Map<string, number> } {
  const trips: TripDraft[] = [];
  const leftOut = new Map<string, number>();
  for (const [feed, { timetable }] of feeds.entries()) {
    const ranges = rangesOf(timetable.stopTimes);
    const ids = new Set([...Object.keys(timetable.trips), ...ranges.keys()]);
    for (const tripId of [...ids].sort()) {
      const draft = draftOf(feed, tripId, timetable, ranges.get(tripId), index);
      if (typeof draft === 'string') leftOut.set(draft, (leftOut.get(draft) ?? 0) + 1);
      else trips.push(draft);
    }
  }
  return { trips, leftOut };
}
