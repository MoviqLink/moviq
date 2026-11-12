import { STOPS_AHEAD, type ExclusionReason, type LiveVehicle } from '@moviq/contracts';
import type { z } from 'zod';

import {
  nycFerryRealtimeSources,
  type ferryPositionsSchema,
  type ferryTripUpdatesSchema,
} from '../../data-platform/sources/ferries/nyc-ferry-realtime.js';
import { createMotionTracker, type MotionTracker } from '../motion.js';
import { liveSource } from '../sources.js';
import type { Timetable } from '../timetable.js';
import { createTally, stopsAhead, timedStop, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS, movementOf } from './movement.js';

const [ferryPositions, ferryTripUpdates] = nycFerryRealtimeSources;

type Vessel = z.infer<typeof ferryPositionsSchema>['vessels'][number];
type FerryTrip = z.infer<typeof ferryTripUpdatesSchema>['trips'][number];

/** The trip's headsign or, when the timetable gives none, the last stop predicted. */
function destinationOf(
  headsign: string | null,
  predicted: FerryTrip,
  timetable: Timetable,
): LiveVehicle['destination'] {
  if (headsign !== null) return { name: headsign, basis: 'timetable' };
  const last = predicted.stops.at(-1);
  const name = last === undefined ? undefined : timetable.stop(last.stopId)?.name;
  return name === undefined ? null : { name, basis: 'last-stop' };
}

/** The boat as Explore shows it, or why it cannot be followed. */
function followBoat(
  vessel: Vessel,
  predicted: FerryTrip | undefined,
  context: FeedContext,
  tracker: MotionTracker,
): LiveVehicle | ExclusionReason {
  const timetable = context.timetables.nycFerry;
  const observedAt = Date.parse(vessel.observedAt);
  if (context.now.getTime() - observedAt > ferryPositions.freshness.staleAfterMs) {
    return 'stale-position';
  }
  const trip = timetable.trip(vessel.tripId);
  const route = trip === undefined ? undefined : timetable.route(trip.route);
  if (trip === undefined || route === undefined) return 'no-line';
  if (predicted === undefined) return 'no-predictions';
  const ahead = stopsAhead(predicted.stops, timetable, context.now);
  if (ahead.length === 0) return 'no-stops-ahead';
  const destination = destinationOf(trip.headsign, predicted, timetable);
  if (destination === null) return 'no-destination';
  const id = `ferry:nyc-ferry:${vessel.vesselId}`;
  const latest = { lat: vessel.latitude, lon: vessel.longitude, at: observedAt };
  const shape = trip.shape ?? null;
  const speed = vessel.speedMetresPerSecond;
  return {
    id,
    mode: 'ferry',
    sourceId: ferryPositions.id,
    tripId: vessel.tripId,
    name: vessel.label,
    line: {
      id: trip.route,
      name: route.shortName ?? route.longName ?? trip.route,
      longName: route.shortName === null ? null : route.longName,
    },
    destination,
    position: context.estimate({
      kind: 'gps',
      vehicleId: id,
      now: context.now,
      mode: 'ferry',
      // Route ids repeat between networks, so the estimator keys them by operator.
      route: `nyc-ferry:${trip.route}`,
      direction: trip.direction,
      line: shape === null ? undefined : timetable.line(shape),
      latest,
      stopsAhead: ahead,
    }),
    ...movementOf(tracker, id, latest, { degrees: null, kmh: speed === null ? null : speed * 3.6 }),
    ...NO_MODE_DETAILS,
    stops: ahead.slice(0, STOPS_AHEAD).map(timedStop),
    delaySeconds: null,
  };
}

/**
 * NYC Ferry boats: GPS positions and speed from its feed, predictions of the same trip, and the
 * route and headsign from its timetable, which the feeds name by trip only. The boats send no
 * course, so it is computed between two reports; the feeds carry no delay.
 */
export function createNycFerryFeed(): LiveModeFeed {
  const tracker = createMotionTracker();
  return {
    mode: 'ferry',
    interestSourceIds: [ferryPositions.id, ferryTripUpdates.id],
    async read(context) {
      const [positions, predictions] = await Promise.all([
        context.reader.read(ferryPositions),
        context.reader.read(ferryTripUpdates),
      ]);
      const trips = new Map((predictions.data?.trips ?? []).map((trip) => [trip.tripId, trip]));
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      for (const vessel of positions.data?.vessels ?? []) {
        const followed = followBoat(vessel, trips.get(vessel.tripId), context, tracker);
        if (typeof followed === 'string') tally.add(followed);
        else vehicles.push(followed);
      }
      tracker.forget(context.now.getTime());
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          liveSource(ferryPositions, positions),
          liveSource(ferryTripUpdates, predictions),
          ...context.timetables.nycFerry.sources,
        ],
        liveSourceIds: [ferryPositions.id, ferryTripUpdates.id],
      };
    },
  };
}
