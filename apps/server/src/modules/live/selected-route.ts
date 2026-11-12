import type { LiveVehicle } from '@moviq/contracts';
import type { SourceReader } from '../data-platform/reader.js';
import { busSources } from '../data-platform/sources/mta/bus-realtime.js';
import { railRealtimeSources } from '../data-platform/sources/regional/rail-realtime.js';
import type { Line } from './estimation/line.js';
import { lineOfTrain } from './feeds/subway-lines.js';
import type { Timetables } from './timetable.js';
import { railLine } from './rail-line.js';
import { subwaySegment } from './subway-segment.js';
import { selectedOtherRoute } from './selected-other-routes.js';

/** Only a current vehicle's own GTFS shape; no straight line between stops is invented. */
export async function selectedRoute(
  vehicle: LiveVehicle,
  reader: SourceReader,
  tables: Timetables,
): Promise<{ coordinates: [number, number][] | null; coverage?: 'full' | 'partial' }> {
  let line: Line | undefined;
  let coverage: 'full' | 'partial' = 'full';
  if (vehicle.mode === 'bus') {
    const reading = vehicle.tripId === undefined ? await reader.read(busSources[0]) : undefined;
    const bus = reading?.data?.vehicles.find((item) => `bus:${item.vehicleId}` === vehicle.id);
    const tripId =
      vehicle.tripId ??
      (bus !== undefined && bus.routeId === vehicle.line?.id ? bus.tripId : undefined);
    const trip = tripId === undefined ? undefined : tables.bus.trip(tripId);
    const shape =
      trip !== undefined && trip.route === vehicle.line?.id ? (trip.shape ?? null) : null;
    line = shape === null ? undefined : tables.bus.line(shape);
  } else if (vehicle.mode === 'subway') {
    const stops = vehicle.stops.flatMap((stop) => {
      const point = tables.subway.stop(stop.id);
      return point === undefined ? [] : [point];
    });
    const tripId = vehicle.id.slice('subway:'.length);
    line = lineOfTrain(tripId, stops, tables.subway);
    if (line === undefined) {
      const station = vehicle.position.station;
      const current =
        station?.status === 'stopped' ? tables.subway.stop(station.id) : vehicle.position;
      const ordered = current === undefined ? stops : [current, ...stops];
      line = subwaySegment(tripId, ordered, tables.subway);
      if (line !== undefined) coverage = 'partial';
    }
  } else if (vehicle.mode === 'rail') {
    line = await selectedRail(vehicle, reader, tables);
  } else {
    line = await selectedOtherRoute(vehicle, reader, tables);
  }
  if (line === undefined || line.points.length > 100_000) return { coordinates: null };
  return { coordinates: line.points.map((point) => [point.lon, point.lat]), coverage };
}

async function selectedRail(
  vehicle: LiveVehicle,
  reader: SourceReader,
  tables: Timetables,
): Promise<Line | undefined> {
  const mnr = vehicle.id.startsWith('rail:mnr:');
  const lirr = vehicle.id.startsWith('rail:lirr:');
  const source = railRealtimeSources.find(
    (item) => item.id === (mnr ? 'mta-metro-north-realtime' : 'mta-lirr-realtime'),
  );
  if ((!mnr && !lirr) || source === undefined) return undefined;
  const tripId = vehicle.id.slice((mnr ? 'rail:mnr:' : 'rail:lirr:').length);
  const reading = await reader.read(source);
  const trip = reading.data?.trips.find((item) => item.tripId === tripId);
  if (trip === undefined || trip.routeId !== vehicle.line?.id) return undefined;
  const table = mnr ? tables.metroNorth : tables.lirr;
  const stops = vehicle.stops.flatMap((stop) => {
    const point = table.stop(stop.id);
    return point === undefined ? [] : [point];
  });
  return railLine(table, tripId, trip.trainNumber, trip.routeId, trip.direction, [
    vehicle.position,
    ...stops.slice(0, 2),
  ]);
}
