import type { BusTripUpdates } from '../../data-platform/sources/mta/bus-realtime.js';
import { gtfsStaticSources } from '../../data-platform/sources/mta/gtfs-static.js';
import type { SubwayFeed } from '../../data-platform/sources/mta/subway-realtime.js';
import type { LivePredictions } from './inputs.js';

/** The subway timetable, which also carries the Staten Island Railway. */
export const SUBWAY_TIMETABLE = 'mta-gtfs-subway';

/** The five borough bus timetables and MTA Bus Company: Bus Time covers all of them. */
const BUS_TIMETABLES: readonly string[] = gtfsStaticSources
  .map((source) => source.id)
  .filter((id) => id.startsWith('mta-gtfs-bus-'));

/** Each trip of the feed, cancelled ones included: a cancelled trip leaves the timetable. */
export function subwayPredictions(feed: SubwayFeed): LivePredictions {
  return {
    timetables: [SUBWAY_TIMETABLE],
    rule: 'mta-subway',
    trips: feed.trips.map((trip) => ({
      tripId: trip.tripId,
      startDate: trip.startDate,
      cancelled: trip.cancelled,
      stops: trip.stops,
    })),
  };
}

export function busPredictions(feed: BusTripUpdates): LivePredictions {
  return {
    timetables: BUS_TIMETABLES,
    rule: 'exact',
    trips: feed.trips.map((trip) => ({
      tripId: trip.tripId,
      startDate: trip.startDate,
      cancelled: trip.cancelled,
      stops: trip.stops,
    })),
  };
}
