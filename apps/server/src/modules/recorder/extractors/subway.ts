import { subwaySources, type SubwayFeed } from '../../data-platform/sources/mta/subway-realtime.js';
import { unixSeconds, type ExtractedEvent } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';
import {
  HORIZON_BANDS,
  arrivalTime,
  createDepartureTracker,
  createPredictionSampler,
  type TripView,
} from './trip-stops.js';

type SubwayTrip = SubwayFeed['trips'][number];
type Train = NonNullable<SubwayTrip['train']>;

function viewOf(trip: SubwayTrip): TripView {
  return {
    tripId: trip.tripId,
    routeId: trip.routeId,
    direction: trip.direction,
    vehicleId: null,
    stops: trip.stops,
  };
}

function arrivalOf(trip: SubwayTrip, train: Train, observedAt: number): ExtractedEvent[] {
  if (train.status !== 'stopped' || train.stopId === null) return [];
  const index = trip.stops.findIndex((stop) => stop.stopId === train.stopId);
  return [
    {
      k: 'stn',
      t: observedAt,
      ev: 'arr',
      trip: trip.tripId,
      route: trip.routeId,
      dir: trip.direction,
      veh: null,
      stop: train.stopId,
      next: index === -1 ? null : (trip.stops[index + 1]?.stopId ?? null),
      lo: observedAt,
      hi: observedAt,
      exact: true,
    },
  ];
}

/**
 * The subway has no GPS: a train is where the MTA says it is (at or heading to a stop). Only
 * changes are recorded, and a change to "stopped at" is an arrival at the time the train gave.
 */
function createTrainTracker() {
  const trains = new Map<string, Train>();
  return {
    observe(trips: readonly SubwayTrip[]): ExtractedEvent[] {
      const events: ExtractedEvent[] = [];
      const seen = new Set<string>();
      for (const trip of trips) {
        seen.add(trip.tripId);
        const train = trip.train;
        if (train === null) continue;
        const before = trains.get(trip.tripId);
        trains.set(trip.tripId, train);
        if (before?.stopId === train.stopId && before.status === train.status) continue;
        const observedAt = unixSeconds(train.observedAt);
        events.push({
          k: 'train',
          t: observedAt,
          trip: trip.tripId,
          route: trip.routeId,
          dir: trip.direction,
          stop: train.stopId,
          status: train.status,
        });
        events.push(...arrivalOf(trip, train, observedAt));
      }
      for (const tripId of trains.keys()) if (!seen.has(tripId)) trains.delete(tripId);
      return events;
    },
  };
}

/** The eight subway feeds: train changes, arrivals, departures and sampled predictions. */
export const subwayExtractors: readonly Extractor[] = subwaySources.map((definition) =>
  extractorFor(definition, { mode: 'subway', restartsDaily: true }, () => {
    const departures = createDepartureTracker();
    const predictions = createPredictionSampler(HORIZON_BANDS, arrivalTime);
    const trains = createTrainTracker();
    return (data) => {
      const feedTime = unixSeconds(data.feedTime);
      // A cancelled trip runs nowhere: its train is not stopped anywhere and it has no segments.
      const running = data.trips.filter((trip) => !trip.cancelled);
      const views = running.map(viewOf);
      return [
        ...trains.observe(running),
        ...departures.observe(views, feedTime),
        ...predictions.observe(views, feedTime),
      ];
    };
  }),
);
