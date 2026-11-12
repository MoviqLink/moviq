import {
  decodeGtfsRealtime,
  encodeGtfsRealtime,
  type GtfsRealtimeFeed,
} from '../../src/modules/data-platform/formats/gtfs-realtime.js';
import { fixture } from './city.js';

type Entity = GtfsRealtimeFeed['entity'][number];

/** The first bus of the positions capture: a Q5 to Laurelton, reported at 01:05:10 UTC. */
export const BUS_8440 = 'MTA NYCT_8440';

/** A B14 whose trip the trimmed Brooklyn timetable lacks: its destination is its last stop. */
export const BUS_7110 = 'MTA NYCT_7110';

/** Metres per degree of latitude on the mean Earth radius. */
const METERS_PER_DEGREE = 111_195;

function captured(file: string): GtfsRealtimeFeed {
  const decoded = decodeGtfsRealtime(fixture(`mta/${file}`));
  if (!decoded.ok) throw new Error(`capture ${file} does not decode: ${decoded.code}`);
  return decoded.feed;
}

function rebuilt(feed: GtfsRealtimeFeed, change: (entity: Entity) => Entity): Uint8Array {
  return encodeGtfsRealtime({ ...feed, entity: feed.entity.map(change) });
}

const vehicleIdOf = (entity: Entity) =>
  entity.vehicle?.vehicle?.id ?? entity.trip_update?.vehicle?.id;

/**
 * The positions capture `seconds` later: bus 8440 has moved `meters` north and reported again;
 * every other bus repeats its last report.
 */
export function busPositionsLater(seconds: number, meters: number): Uint8Array {
  const feed = captured('bus-vehicle-positions.pb');
  const later = {
    ...feed,
    header: { ...feed.header, timestamp: (feed.header.timestamp ?? 0) + seconds },
  };
  return rebuilt(later, (entity) => {
    const { vehicle } = entity;
    if (vehicleIdOf(entity) !== BUS_8440 || vehicle?.position === undefined) return entity;
    return {
      ...entity,
      vehicle: {
        ...vehicle,
        position: {
          ...vehicle.position,
          latitude: vehicle.position.latitude + meters / METERS_PER_DEGREE,
        },
        timestamp: (vehicle.timestamp ?? 0) + seconds,
      },
    };
  });
}

/** The first train of the A, C and E capture: an A stopped at 181 St (`A06N`) at 01:04:55 UTC. */
export const TRAIN_A = '109850_A..N55R';

/**
 * The A, C and E capture `seconds` later: train `TRAIN_A` has left 181 St and runs to 190 St,
 * which the MTA now expects `delay` seconds later than before; every other train is unchanged.
 */
export function subwayLater(seconds: number, delay: number): Uint8Array {
  const feed = captured('subway-ace.pb');
  const later = {
    ...feed,
    header: { ...feed.header, timestamp: (feed.header.timestamp ?? 0) + seconds },
  };
  const shifted = <E extends { readonly time?: number | undefined }>(event: E | undefined) =>
    event?.time === undefined ? event : { ...event, time: event.time + delay };
  return rebuilt(later, (entity) => {
    const { trip_update: update, vehicle } = entity;
    if (update?.trip.trip_id === TRAIN_A) {
      const stops = update.stop_time_update.slice(1).map((stop) => ({
        ...stop,
        arrival: shifted(stop.arrival),
        departure: shifted(stop.departure),
      }));
      return { ...entity, trip_update: { ...update, stop_time_update: stops } };
    }
    if (vehicle?.trip?.trip_id !== TRAIN_A) return entity;
    return {
      ...entity,
      vehicle: {
        ...vehicle,
        current_status: 'IN_TRANSIT_TO',
        stop_id: 'A05N',
        timestamp: (vehicle.timestamp ?? 0) + seconds,
      },
    };
  });
}

/** The positions capture with one bus on a route no timetable has and one on an unknown trip. */
export function positionsWith(change: { unknownRoute: string; noTrip: string }): Uint8Array {
  return rebuilt(captured('bus-vehicle-positions.pb'), (entity) => {
    const { vehicle } = entity;
    const id = vehicleIdOf(entity);
    if (vehicle?.trip === undefined || (id !== change.unknownRoute && id !== change.noTrip)) {
      return entity;
    }
    const trip =
      id === change.unknownRoute
        ? { ...vehicle.trip, route_id: 'X999' }
        : { ...vehicle.trip, trip_id: 'trip-without-predictions' };
    return { ...entity, vehicle: { ...vehicle, trip } };
  });
}

/** The predictions capture with the last stop of one bus's trip unknown to every timetable. */
export function busTripsWith(change: { unknownLastStop: string }): Uint8Array {
  return rebuilt(captured('bus-trip-updates.pb'), (entity) => {
    const update = entity.trip_update;
    if (update === undefined || vehicleIdOf(entity) !== change.unknownLastStop) return entity;
    const stops = update.stop_time_update;
    const last = stops.at(-1);
    if (last === undefined) return entity;
    return {
      ...entity,
      trip_update: {
        ...update,
        stop_time_update: [...stops.slice(0, -1), { ...last, stop_id: 'NOWHERE' }],
      },
    };
  });
}
