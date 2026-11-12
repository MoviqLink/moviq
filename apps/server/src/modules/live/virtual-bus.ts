import { STOPS_AHEAD, type LiveSource, type LiveVehicle } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { SourceReader } from '../data-platform/reader.js';
import { busSources } from '../data-platform/sources/mta/bus-realtime.js';
import type { LiveCity } from './city.js';
import type { PlacedStop } from './estimate.js';
import { stopsAhead, timedStop } from './feeds/feed.js';
import { liveSource } from './sources.js';
import { createTimetables } from './timetable.js';

/** Published GPS and timed stops, never a simulated journey or an interpolated GPS fix. */
export interface VirtualBusReading {
  readonly tripId: string;
  readonly vehicle: LiveVehicle;
  readonly source: LiveSource;
  readonly sources: readonly LiveSource[];
  readonly stops: readonly PlacedStop[];
}

const [positionsSource, predictionsSource] = busSources;
const MAX_POSITION_AGE_MS = 120_000;
const MAX_FUTURE_MS = 30_000;
const VIRTUAL_STOPS_AHEAD = 8;

/** A healthy feed may contain an old individual fix: check both ages independently. */
function current(at: string | null, now: Date, limit: number): boolean {
  if (at === null) return false;
  const age = now.getTime() - Date.parse(at);
  return Number.isFinite(age) && age >= -MAX_FUTURE_MS && age <= limit;
}

/**
 * Uses the same admitted sources as the map, extending its three-stop card to eight timed stops.
 * Null means unavailable now. The owning ride retains and labels its last known reading.
 */
export function createVirtualBusReader(deps: {
  readonly city: LiveCity;
  readonly reader: SourceReader;
  readonly clock: Clock;
}): (vehicleId: string) => Promise<VirtualBusReading | null> {
  const timetables = createTimetables(deps.reader, deps.clock);
  return async (vehicleId) => {
    if (!vehicleId.startsWith('bus:')) return null;
    const [snapshot, positions, predictions, tables] = await Promise.all([
      deps.city.snapshot(),
      deps.reader.read(positionsSource),
      deps.reader.read(predictionsSource),
      timetables.current(),
    ]);
    const now = deps.clock.now();
    if (positions.provenance.state !== 'healthy' || predictions.provenance.state !== 'healthy')
      return null;
    if (!current(positions.provenance.dataTime, now, positionsSource.freshness.degradedAfterMs))
      return null;
    if (!current(predictions.provenance.dataTime, now, predictionsSource.freshness.degradedAfterMs))
      return null;
    const mapped = snapshot.vehicles.find((item) => item.id === vehicleId && item.mode === 'bus');
    const bus = positions.data?.vehicles.find((item) => `bus:${item.vehicleId}` === vehicleId);
    if (
      mapped === undefined ||
      bus === undefined ||
      !current(bus.observedAt, now, MAX_POSITION_AGE_MS)
    )
      return null;
    const trip = predictions.data?.trips.find((item) => item.tripId === bus.tripId);
    if (trip === undefined || trip.cancelled || trip.routeId !== bus.routeId) return null;
    if (trip.vehicleId !== null && trip.vehicleId !== bus.vehicleId) return null;
    if (
      trip.updatedAt !== null &&
      !current(trip.updatedAt, now, predictionsSource.freshness.degradedAfterMs)
    )
      return null;
    const stops = stopsAhead(trip.stops, tables.bus, now).slice(0, VIRTUAL_STOPS_AHEAD);
    const route = tables.bus.route(bus.routeId);
    const headsign = tables.bus.trip(bus.tripId)?.headsign;
    const lastId = trip.stops.at(-1)?.stopId;
    const lastName = lastId === undefined ? undefined : tables.bus.stop(lastId)?.name;
    const destination = headsign
      ? { name: headsign, basis: 'timetable' as const }
      : lastName
        ? { name: lastName, basis: 'last-stop' as const }
        : null;
    if (stops.length === 0 || route === undefined || destination === null) return null;
    const source = liveSource(positionsSource, positions);
    return {
      tripId: bus.tripId,
      vehicle: {
        ...mapped,
        line: { id: bus.routeId, name: route.shortName ?? bus.routeId, longName: route.longName },
        destination,
        position: {
          lat: bus.latitude,
          lon: bus.longitude,
          basis: 'gps',
          dataTime: bus.observedAt,
          marginMeters: null,
          station: null,
          stall: null,
        },
        stops: stops.slice(0, STOPS_AHEAD).map(timedStop),
      },
      stops,
      source,
      sources: [source, liveSource(predictionsSource, predictions), ...tables.bus.sources],
    };
  };
}
