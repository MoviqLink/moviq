import { STOPS_AHEAD, type ExclusionReason, type LiveVehicle } from '@moviq/contracts';
import type { z } from 'zod';

import {
  busSources,
  type busPositionsSchema,
  type BusTripUpdates,
} from '../../data-platform/sources/mta/bus-realtime.js';
import { normalBearing } from '../geo.js';
import { createMotionTracker, type MotionTracker } from '../motion.js';
import { liveSource } from '../sources.js';
import type { Timetable } from '../timetable.js';
import { createTally, stopsAhead, timedStop, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS } from './movement.js';

const [busPositions, busTripUpdates] = busSources;

type BusVehicle = z.infer<typeof busPositionsSchema>['vehicles'][number];
type BusTrip = BusTripUpdates['trips'][number];

/** `MTA NYCT_8440` and `MTABC_6012` are buses 8440 and 6012: the fleet number follows the agency. */
function fleetNumber(vehicleId: string): string {
  return vehicleId.slice(vehicleId.lastIndexOf('_') + 1) || vehicleId;
}

/** The headsign of its trip or, when the timetable lacks the trip, the last stop predicted. */
function destinationOf(
  tripId: string,
  trip: BusTrip,
  timetable: Timetable,
): LiveVehicle['destination'] {
  const headsign = timetable.trip(tripId)?.headsign ?? null;
  if (headsign !== null) return { name: headsign, basis: 'timetable' };
  const last = trip.stops.at(-1);
  const name = last === undefined ? undefined : timetable.stop(last.stopId)?.name;
  return name === undefined ? null : { name, basis: 'last-stop' };
}

/** The bus as Explore shows it, or why it cannot be followed. */
/**
 * People on board and room, only when the bus sends both: a level alone (`occupancy_status`) is
 * a state, not a count, and a capacity is never derived.
 */
export function occupancyOf(occupancy: BusVehicle['occupancy']): LiveVehicle['occupancy'] {
  const passengers = occupancy?.passengers ?? null;
  const capacity = occupancy?.capacity ?? null;
  return passengers === null || capacity === null ? null : { passengers, capacity };
}

function followBus(
  bus: BusVehicle,
  trip: BusTrip | undefined,
  context: FeedContext,
  tracker: MotionTracker,
): LiveVehicle | ExclusionReason {
  const timetable = context.timetables.bus;
  const observedAt = Date.parse(bus.observedAt);
  if (context.now.getTime() - observedAt > busPositions.freshness.staleAfterMs) {
    return 'stale-position';
  }
  const route = timetable.route(bus.routeId);
  if (route === undefined) return 'no-line';
  if (trip === undefined) return 'no-predictions';
  const ahead = stopsAhead(trip.stops, timetable, context.now);
  if (ahead.length === 0) return 'no-stops-ahead';
  const destination = destinationOf(bus.tripId, trip, timetable);
  if (destination === null) return 'no-destination';

  const latest = { lat: bus.latitude, lon: bus.longitude, at: observedAt };
  tracker.observe(bus.vehicleId, latest);
  const motion = tracker.motion(bus.vehicleId);
  const reported = normalBearing(bus.bearing);
  const computed = motion?.bearing ?? null;
  const id = `bus:${bus.vehicleId}`;
  const shape = timetable.trip(bus.tripId)?.shape ?? null;
  return {
    id,
    tripId: bus.tripId,
    mode: 'bus',
    sourceId: busPositions.id,
    name: fleetNumber(bus.vehicleId),
    line: { id: bus.routeId, name: route.shortName ?? bus.routeId, longName: route.longName },
    destination,
    position: context.estimate({
      kind: 'gps',
      vehicleId: id,
      now: context.now,
      mode: 'bus',
      route: bus.routeId,
      direction: bus.direction,
      line: shape === null ? undefined : timetable.line(shape),
      latest,
      stopsAhead: ahead,
    }),
    bearing:
      reported !== null
        ? { degrees: reported, basis: 'reported' }
        : computed === null
          ? null
          : { degrees: computed, basis: 'computed' },
    speed:
      motion === undefined
        ? null
        : { kmh: motion.kmh, basis: 'computed', overSeconds: motion.overSeconds },
    ...NO_MODE_DETAILS,
    occupancy: occupancyOf(bus.occupancy),
    stops: ahead.slice(0, STOPS_AHEAD).map(timedStop),
    delaySeconds: trip.delaySeconds,
  };
}

/**
 * MTA buses: GPS positions from Bus Time, their predictions for the same trip, and the line and
 * headsign from the timetables. Bus Time publishes no speed, so it is computed between two
 * reports of the same bus; until a second report arrives, a bus has none.
 */
export function createBusFeed(): LiveModeFeed {
  const tracker = createMotionTracker();
  return {
    mode: 'bus',
    interestSourceIds: [busPositions.id, busTripUpdates.id],
    async read(context) {
      const [positions, predictions] = await Promise.all([
        context.reader.read(busPositions),
        context.reader.read(busTripUpdates),
      ]);
      const trips = new Map((predictions.data?.trips ?? []).map((trip) => [trip.tripId, trip]));
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      for (const bus of positions.data?.vehicles ?? []) {
        const followed = followBus(bus, trips.get(bus.tripId), context, tracker);
        if (typeof followed === 'string') tally.add(followed);
        else vehicles.push(followed);
      }
      tracker.forget(context.now.getTime());
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          liveSource(busPositions, positions),
          liveSource(busTripUpdates, predictions),
          ...context.timetables.bus.sources,
        ],
        liveSourceIds: [busPositions.id, busTripUpdates.id],
      };
    },
  };
}
