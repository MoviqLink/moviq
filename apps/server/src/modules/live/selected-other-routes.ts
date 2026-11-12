import type { LiveVehicle } from '@moviq/contracts';

import type { SourceReader } from '../data-platform/reader.js';
import { nycFerryRealtimeSources } from '../data-platform/sources/ferries/nyc-ferry-realtime.js';
import { passioGoSource } from '../data-platform/sources/shuttles/passio-go.js';
import { passioRouteSource } from '../data-platform/sources/shuttles/passio-routes.js';
import { airportShuttleSources } from '../data-platform/sources/shuttles/passio-airports.js';
import { lineOf, type Line } from './estimation/line.js';
import type { Timetables } from './timetable.js';

/** Shapes explicitly named by the current GTFS trip of the selected vehicle. */
export async function selectedOtherRoute(
  vehicle: LiveVehicle,
  reader: SourceReader,
  tables: Timetables,
): Promise<Line | undefined> {
  if (vehicle.mode === 'shuttle') {
    return vehicle.sourceId === passioGoSource.id
      ? selectedPassio(vehicle, reader)
      : selectedNewark(vehicle, tables);
  }
  const positions = nycFerryRealtimeSources[0];
  const prefix = 'ferry:nyc-ferry:';
  if (
    vehicle.mode !== 'ferry' ||
    vehicle.sourceId !== positions.id ||
    !vehicle.id.startsWith(prefix)
  )
    return undefined;
  const trip = vehicle.tripId === undefined ? undefined : tables.nycFerry.trip(vehicle.tripId);
  if (
    trip === undefined ||
    trip.route !== vehicle.line?.id ||
    trip.shape === null ||
    trip.shape === undefined
  )
    return undefined;
  return tables.nycFerry.line(trip.shape);
}

function selectedNewark(vehicle: LiveVehicle, tables: Timetables): Line | undefined {
  const positions = airportShuttleSources.find((source) => source.id === 'ewr-shuttle-positions');
  if (vehicle.sourceId !== positions?.id) return undefined;
  const prefix = `shuttle:${positions.id}:`;
  if (!vehicle.id.startsWith(prefix)) return undefined;
  const trip = vehicle.tripId === undefined ? undefined : tables.newarkShuttle.trip(vehicle.tripId);
  if (trip?.shape === null || trip?.shape === undefined) return undefined;
  return tables.newarkShuttle.line(trip.shape);
}

async function selectedPassio(
  vehicle: LiveVehicle,
  reader: SourceReader,
): Promise<Line | undefined> {
  const prefix = `shuttle:${passioGoSource.id}:`;
  if (!vehicle.id.startsWith(prefix) || vehicle.line === null) return undefined;
  const routes = await reader.read(passioRouteSource);
  const route = routes.data?.[vehicle.line.id];
  const shape = typeof route === 'string' ? route : route?.shape;
  return shape === undefined ? undefined : lineOf(vehicle.line.id, shape);
}
