import { STOPS_AHEAD, type ExclusionReason, type LiveVehicle } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import { subwaySources, type SubwayFeed } from '../../data-platform/sources/mta/subway-realtime.js';
import type { PlacedStop } from '../estimate.js';
import { bearingDegrees } from '../geo.js';
import { liveSource } from '../sources.js';
import type { Timetable } from '../timetable.js';
import { createTally, stopsAhead, timedStop, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS } from './movement.js';
import { lineOfTrain } from './subway-lines.js';

type SubwayTrip = SubwayFeed['trips'][number];
type Train = NonNullable<SubwayTrip['train']>;

const STATUS = {
  stopped: 'stopped',
  incoming: 'arriving',
  'in-transit': 'heading',
} as const satisfies Record<NonNullable<Train['status']>, string>;

/** The station of the train, placed by the timetable, and how the train stands to it. */
function stationOf(train: Train, timetable: Timetable) {
  if (train.stopId === null) return undefined;
  const stop = timetable.stop(train.stopId);
  if (stop === undefined) return undefined;
  return {
    id: train.stopId,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    arrival: null,
    departure: null,
    // The MTA leaves the status out for a train between stations: it is heading to the next one.
    status: STATUS[train.status ?? 'in-transit'],
  };
}

/** The stops the operator still lists, in order and placed; one the timetable lacks ends them. */
function listedStops(trip: SubwayTrip, timetable: Timetable): PlacedStop[] {
  const placed: PlacedStop[] = [];
  for (const stop of trip.stops) {
    const known = timetable.stop(stop.stopId);
    if (known === undefined) break;
    placed.push({
      id: stop.stopId,
      name: known.name,
      lat: known.lat,
      lon: known.lon,
      arrival: stop.arrival,
      departure: stop.departure,
    });
  }
  return placed;
}

/** The direction of travel: from the train's station towards the next stop after it. */
function courseOf(station: PlacedStop, ahead: readonly PlacedStop[]): number | null {
  const next = ahead.find((stop) => stop.id !== station.id);
  return next === undefined ? null : bearingDegrees(station, next);
}

/** The train as Explore shows it, or why it cannot be followed. */
function followTrain(
  trip: SubwayTrip,
  definition: SourceDefinition,
  context: FeedContext,
  feedTime: Date,
): LiveVehicle | ExclusionReason {
  const timetable = context.timetables.subway;
  const { train } = trip;
  if (train === null) return 'not-departed';
  const observedAt = new Date(train.observedAt);
  if (context.now.getTime() - observedAt.getTime() > definition.freshness.staleAfterMs) {
    return 'stale-position';
  }
  const route = timetable.route(trip.routeId);
  if (route === undefined) return 'no-line';
  const station = stationOf(train, timetable);
  if (station === undefined) return 'no-position';
  const ahead = stopsAhead(trip.stops, timetable, context.now).filter(
    (stop) => !(station.status === 'stopped' && stop.id === station.id),
  );
  if (ahead.length === 0) return 'no-stops-ahead';
  // The MTA lists every stop to the end of the trip, so the last one is where it ends.
  const last = trip.stops.at(-1);
  const end = last === undefined ? undefined : timetable.stop(last.stopId);
  if (end === undefined) return 'no-destination';
  const course = courseOf(station, ahead);
  const id = `subway:${trip.tripId}`;
  const listed = listedStops(trip, timetable);
  return {
    id,
    mode: 'subway',
    sourceId: definition.id,
    name: null,
    line: { id: trip.routeId, name: route.shortName ?? trip.routeId, longName: route.longName },
    destination: { name: end.name, basis: 'last-stop' },
    position: context.estimate({
      kind: 'station',
      vehicleId: id,
      now: context.now,
      mode: 'subway',
      route: trip.routeId,
      line: lineOfTrain(trip.tripId, listed.slice(0, 3), timetable),
      station,
      observedAt,
      next: listed[0],
      predictedAt: feedTime,
    }),
    bearing: course === null ? null : { degrees: course, basis: 'computed' },
    speed: null,
    ...NO_MODE_DETAILS,
    stops: ahead.slice(0, STOPS_AHEAD).map(timedStop),
    delaySeconds: null,
  };
}

/**
 * Subway trains from the eight MTA feeds. The MTA publishes no GPS for them: each train is
 * placed at the station it is at or heading to, as `predicted`, and its course points to the
 * stop after it. The feeds carry no timetable deviation, so a train has no delay.
 */
export function createSubwayFeed(): LiveModeFeed {
  return {
    mode: 'subway',
    interestSourceIds: subwaySources.map((definition) => definition.id),
    async read(context) {
      const readings = await Promise.all(
        subwaySources.map(async (definition) => ({
          definition,
          reading: await context.reader.read(definition),
        })),
      );
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      for (const { definition, reading } of readings) {
        if (reading.data === undefined) continue;
        const feedTime = new Date(reading.data.feedTime);
        for (const trip of reading.data.trips) {
          const followed = followTrain(trip, definition, context, feedTime);
          if (typeof followed === 'string') tally.add(followed);
          else vehicles.push(followed);
        }
      }
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          ...readings.map(({ definition, reading }) => liveSource(definition, reading)),
          ...context.timetables.subway.sources,
        ],
        liveSourceIds: subwaySources.map((definition) => definition.id),
      };
    },
  };
}
