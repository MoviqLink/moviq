import {
  decodeGtfsRealtime,
  encodeGtfsRealtime,
  type GtfsRealtimeFeed,
} from '../../../apps/server/src/modules/data-platform/formats/gtfs-realtime.js';
import { MINUTE } from './clock-shift.js';

type Entity = GtfsRealtimeFeed['entity'][number];
type TripUpdate = NonNullable<Entity['trip_update']>;
type StopTimeUpdate = TripUpdate['stop_time_update'][number];
type StopTimeEvent = StopTimeUpdate['arrival'];

/**
 * A hold-up at a station asked for by a test: from the moment the train of the plan is due there
 * (the trip of `routeId` predicted at `stopId` nearest to `plannedAt`), every trip of the route
 * calling at that station, in either direction, is predicted `minutes` later at every stop, as a
 * hold-up delays both platforms. Trains due earlier keep their times.
 */
export interface TrainDelay {
  readonly routeId: string;
  readonly stopId: string;
  readonly plannedAt: string;
  readonly minutes: number;
}

const seconds = (ms: number): number => Math.round(ms / 1000);

/** A Unix time in seconds moved by `shiftS`; 0 and absent mean "no time" and stay so. */
function moved(time: number | undefined, shiftS: number): number | undefined {
  return time === undefined || time === 0 ? time : time + shiftS;
}

function shiftEvent(event: StopTimeEvent, shiftS: number): StopTimeEvent {
  if (event?.time === undefined) return event;
  return { ...event, time: event.time + shiftS };
}

function shiftStops(updates: readonly StopTimeUpdate[], shiftS: number): StopTimeUpdate[] {
  return updates.map((update) => ({
    ...update,
    arrival: shiftEvent(update.arrival, shiftS),
    departure: shiftEvent(update.departure, shiftS),
  }));
}

/** Every time of one entity moved by the same amount; ids, stops and order untouched. */
function shiftEntity(entity: Entity, shiftS: number): Entity {
  const { trip_update: update, vehicle, alert } = entity;
  return {
    ...entity,
    trip_update:
      update === undefined
        ? undefined
        : {
            ...update,
            timestamp: moved(update.timestamp, shiftS),
            stop_time_update: shiftStops(update.stop_time_update, shiftS),
          },
    vehicle:
      vehicle === undefined
        ? undefined
        : { ...vehicle, timestamp: moved(vehicle.timestamp, shiftS) },
    alert:
      alert === undefined
        ? undefined
        : {
            ...alert,
            active_period: alert.active_period.map((period) => ({
              start: moved(period.start, shiftS),
              end: moved(period.end, shiftS),
            })),
          },
  };
}

/** Subway stop ids name the platform with a direction suffix (`631N`); the station is `631`. */
const stationOf = (stopId: string): string => stopId.replace(/[NS]$/, '');

/** The trip's predicted time at the first stop that `isHere` accepts, in Unix seconds. */
function timeAt(update: TripUpdate, isHere: (stopId: string) => boolean): number | undefined {
  const stop = update.stop_time_update.find((candidate) => isHere(candidate.stop_id ?? ''));
  const time = stop?.arrival?.time ?? stop?.departure?.time;
  return time === undefined || time === 0 ? undefined : time;
}

/** From when, at the delay's stop, trains of the route run late: the followed train's time. */
function lateFrom(entities: readonly Entity[], delay: TrainDelay): number | undefined {
  const planned = seconds(Date.parse(delay.plannedAt));
  let nearest: number | undefined;
  for (const { trip_update: update } of entities) {
    if (update?.trip.route_id !== delay.routeId) continue;
    const time = timeAt(update, (stopId) => stopId === delay.stopId);
    if (time === undefined) continue;
    if (nearest === undefined || Math.abs(time - planned) < Math.abs(nearest - planned))
      nearest = time;
  }
  return nearest;
}

function applyDelay(entities: readonly Entity[], delay: TrainDelay): Entity[] {
  const from = lateFrom(entities, delay);
  if (from === undefined) return [...entities];
  const lateS = seconds(delay.minutes * MINUTE);
  const station = stationOf(delay.stopId);
  return entities.map((entity) => {
    const update = entity.trip_update;
    if (update?.trip.route_id !== delay.routeId) return entity;
    const time = timeAt(update, (stopId) => stationOf(stopId) === station);
    if (time === undefined || time < from) return entity;
    return {
      ...entity,
      trip_update: { ...update, stop_time_update: shiftStops(update.stop_time_update, lateS) },
    };
  });
}

/**
 * A GTFS Realtime capture with every time moved by `shiftMs`, then the delays applied. Encoded
 * again with the fields MovIQ reads, as the live captures of `tests/fixtures/` are.
 */
export function shiftGtfsRealtime(
  body: Uint8Array,
  shiftMs: number,
  delays: readonly TrainDelay[],
): Uint8Array {
  const decoded = decodeGtfsRealtime(body);
  if (!decoded.ok) throw new Error(`Not a GTFS Realtime capture: ${decoded.detail}`);
  const shiftS = seconds(shiftMs);
  const { feed } = decoded;
  const entities = delays.reduce(
    (current, delay) => applyDelay(current, delay),
    feed.entity.map((entity) => shiftEntity(entity, shiftS)),
  );
  return encodeGtfsRealtime({
    header: { ...feed.header, timestamp: moved(feed.header.timestamp, shiftS) },
    entity: entities,
  });
}

/** The header time of a GTFS Realtime capture: the moment it describes. */
export function gtfsRealtimeTime(body: Uint8Array): number {
  const decoded = decodeGtfsRealtime(body);
  const time = decoded.ok ? decoded.feed.header.timestamp : undefined;
  if (time === undefined || time === 0) throw new Error('The capture has no header time.');
  return time * 1000;
}
