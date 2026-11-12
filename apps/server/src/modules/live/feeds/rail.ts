import { STOPS_AHEAD, type ExclusionReason, type LiveVehicle } from '@moviq/contracts';
import type { z } from 'zod';

import type { SourceDefinition } from '../../data-platform/definition.js';
import {
  railRealtimeSources,
  type railFeedSchema,
} from '../../data-platform/sources/regional/rail-realtime.js';
import type { PlacedStop } from '../estimate.js';
import { bearingDegrees } from '../geo.js';
import { place } from '../estimation/line.js';
import { createMotionTracker, type MotionTracker } from '../motion.js';
import { liveSource } from '../sources.js';
import { railLine } from '../rail-line.js';
import type { Network, Timetable } from '../timetable.js';
import { createTally, stopsAhead, timedStop, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS, movementOf } from './movement.js';

type RailFeed = z.infer<typeof railFeedSchema>;
type RailTrip = RailFeed['trips'][number];
type Train = NonNullable<RailTrip['train']>;

/** A railroad: its live trains, the network of its timetable and the key of its vehicle ids. */
interface Railroad {
  readonly source: SourceDefinition<RailFeed>;
  readonly network: Extract<Network, 'lirr' | 'metroNorth'>;
  readonly key: string;
}

const STATUS = {
  stopped: 'stopped',
  incoming: 'arriving',
  'in-transit': 'heading',
} as const satisfies Record<NonNullable<Train['status']>, string>;

/** The trip's headsign or, when the timetable lacks the trip, the stop where it ends. */
function destinationOf(trip: RailTrip, timetable: Timetable): LiveVehicle['destination'] {
  const headsign = timetable.trip(trip.tripId)?.headsign ?? null;
  if (headsign !== null) return { name: headsign, basis: 'timetable' };
  const end = timetable.stop(trip.finalStopId);
  return end === undefined ? null : { name: end.name, basis: 'last-stop' };
}

/** The stop a train without GPS is at or heading to, placed by the timetable. */
function stationOf(train: Train, timetable: Timetable) {
  const stop = train.stopId === null ? undefined : timetable.stop(train.stopId);
  if (train.stopId === null || stop === undefined) return undefined;
  return {
    id: train.stopId,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    arrival: null,
    departure: null,
    status: STATUS[train.status ?? 'in-transit'],
  };
}

interface Followed {
  readonly position: LiveVehicle['position'];
  readonly bearing: LiveVehicle['bearing'];
  readonly speed: LiveVehicle['speed'];
}

/** Where the train is: its GPS followed along its shape, or the stop it names, as published. */
function placeTrain(
  trip: RailTrip,
  train: Train,
  observedAt: number,
  ahead: readonly PlacedStop[],
  railroad: Railroad,
  context: FeedContext,
  tracker: MotionTracker,
): Followed | ExclusionReason {
  const timetable = context.timetables[railroad.network];
  const id = `rail:${railroad.key}:${trip.tripId}`;
  // Route ids repeat between networks (LIRR, Metro-North and the subway all have a `1`).
  const route = `${railroad.key}:${trip.routeId}`;
  if (train.position.located === 'gps') {
    const latest = { lat: train.position.latitude, lon: train.position.longitude, at: observedAt };
    const shape = timetable.trip(trip.tripId)?.shape ?? null;
    return {
      position: context.estimate({
        kind: 'gps',
        vehicleId: id,
        now: context.now,
        mode: 'rail',
        route,
        direction: trip.direction,
        line: shape === null ? undefined : timetable.line(shape),
        latest,
        stopsAhead: ahead,
      }),
      ...movementOf(tracker, id, latest, { degrees: null, kmh: null }),
    };
  }
  const station = stationOf(train, timetable);
  if (station === undefined) return 'no-position';
  const next = ahead.find((stop) => stop.id !== station.id);
  const points = [station, ...ahead.filter((stop) => stop.id !== station.id).slice(0, 2)];
  const shape = railLine(
    timetable,
    trip.tripId,
    trip.trainNumber,
    trip.routeId,
    trip.direction,
    points,
  );
  const line =
    shape !== undefined && points.every((point) => place(shape, point).offsetMeters <= 100)
      ? shape
      : undefined;
  return {
    // A station-based train may be estimated along its verified timetable shape.
    position: context.estimate({
      kind: 'station',
      vehicleId: id,
      now: context.now,
      mode: 'rail',
      route,
      line,
      station,
      observedAt: new Date(observedAt),
      next: ahead[0],
      predictedAt: new Date(observedAt),
    }),
    bearing:
      next === undefined ? null : { degrees: bearingDegrees(station, next), basis: 'computed' },
    speed: null,
  };
}

/** The train as Explore shows it, or why it cannot be followed. */
function followTrain(
  trip: RailTrip,
  data: RailFeed,
  railroad: Railroad,
  context: FeedContext,
  tracker: MotionTracker,
): LiveVehicle | ExclusionReason {
  const timetable = context.timetables[railroad.network];
  const { train } = trip;
  if (train === null) return 'not-departed';
  // Metro-North stamps every train with the header time, which is then the time of its report.
  const observedAt = Date.parse(train.observedAt ?? data.dataTime);
  if (context.now.getTime() - observedAt > railroad.source.freshness.staleAfterMs) {
    return 'stale-position';
  }
  const route = timetable.route(trip.routeId);
  if (route === undefined) return 'no-line';
  // The railroads list the whole trip, past stops included; only those still ahead count.
  const ahead = stopsAhead(trip.stops, timetable, context.now).filter(
    (stop) => !(train.status === 'stopped' && stop.id === train.stopId),
  );
  if (ahead.length === 0) return 'no-stops-ahead';
  const destination = destinationOf(trip, timetable);
  if (destination === null) return 'no-destination';
  const placed = placeTrain(trip, train, observedAt, ahead, railroad, context, tracker);
  if (typeof placed === 'string') return placed;
  return {
    id: `rail:${railroad.key}:${trip.tripId}`,
    mode: 'rail',
    sourceId: railroad.source.id,
    name: train.label ?? trip.trainNumber,
    line: {
      id: trip.routeId,
      name: route.shortName ?? route.longName ?? trip.routeId,
      longName: route.shortName === null ? null : route.longName,
    },
    destination,
    ...placed,
    ...NO_MODE_DETAILS,
    stops: ahead.slice(0, STOPS_AHEAD).map(timedStop),
    delaySeconds: null,
  };
}

/**
 * The trains of one railroad from the MTA's GTFS Realtime: those that send GPS are followed along
 * the shape of their trip; others use their station and, when verified, the timetable shape. The feeds
 * carry no timetable deviation, so a train has no delay.
 */
function createRailFeed(railroad: Railroad): LiveModeFeed {
  const tracker = createMotionTracker();
  return {
    mode: 'rail',
    interestSourceIds: [railroad.source.id],
    async read(context) {
      const reading = await context.reader.read(railroad.source);
      const { data } = reading;
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      const trains =
        data === undefined
          ? []
          : data.trips.map((trip) => followTrain(trip, data, railroad, context, tracker));
      for (const followed of trains) {
        if (typeof followed === 'string') tally.add(followed);
        else vehicles.push(followed);
      }
      tracker.forget(context.now.getTime());
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          liveSource(railroad.source, reading),
          ...context.timetables[railroad.network].sources,
        ],
        liveSourceIds: [railroad.source.id],
      };
    },
  };
}

function realtimeSource(id: string): SourceDefinition<RailFeed> {
  const found = railRealtimeSources.find((definition) => definition.id === id);
  if (found === undefined) throw new Error(`No live source ${id} among the railroads`);
  return found;
}

/** Long Island Rail Road: every train sends GPS. */
export const createLirrFeed = (): LiveModeFeed =>
  createRailFeed({ source: realtimeSource('mta-lirr-realtime'), network: 'lirr', key: 'lirr' });

/** Metro-North: some trains send GPS, the others name their stop. */
export const createMetroNorthFeed = (): LiveModeFeed =>
  createRailFeed({
    source: realtimeSource('mta-metro-north-realtime'),
    network: 'metroNorth',
    key: 'mnr',
  });
