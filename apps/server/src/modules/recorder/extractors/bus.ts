import type { z } from 'zod';

import {
  busSources,
  type busPositionsSchema,
} from '../../data-platform/sources/mta/bus-realtime.js';
import { roundCoordinate, unixSeconds, type ExtractedEvent } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';
import { createPredictionSampler, departureTime, type TripView } from './trip-stops.js';

const [busPositions, busTripUpdates] = busSources;

type BusVehicle = z.infer<typeof busPositionsSchema>['vehicles'][number];

/** GPS noise of a bus standing still stays within this distance of where it stopped. */
const SAME_PLACE_METRES = 15;
/** While a bus stands still, a checkpoint with the count of reports is written this often. */
const HELD_CHECKPOINT_SECONDS = 60;
/** Buses are predicted in fewer bands than the subway: their feed is the largest of the city. */
const BUS_HORIZON_BANDS = [120, 300, 600] as const;

interface VehicleMemory {
  readonly trip: string;
  readonly route: string;
  readonly dir: string | null;
  readonly stop: string | null;
  readonly lat: number;
  readonly lon: number;
  /** When the vehicle first reported its current place, and how many reports since. */
  readonly since: number;
  readonly reports: number;
  readonly lastReport: number;
  readonly lastHeld: number;
}

/** Distance in metres on a local flat approximation, exact enough within a few hundred metres. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dy = (lat2 - lat1) * 110_574;
  const dx = (lon2 - lon1) * 111_320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

const directionText = (direction: 0 | 1 | null): string | null =>
  direction === null ? null : String(direction);

function startOf(bus: BusVehicle, at: number): { memory: VehicleMemory; events: ExtractedEvent[] } {
  const lat = roundCoordinate(bus.latitude);
  const lon = roundCoordinate(bus.longitude);
  const dir = directionText(bus.direction);
  const memory: VehicleMemory = {
    trip: bus.tripId,
    route: bus.routeId,
    dir,
    stop: bus.stopId,
    lat,
    lon,
    since: at,
    reports: 1,
    lastReport: at,
    lastHeld: at,
  };
  const events: ExtractedEvent[] = [
    { k: 'assign', t: at, veh: bus.vehicleId, trip: bus.tripId, route: bus.routeId, dir },
    gpsOf(bus, at, lat, lon),
  ];
  return { memory, events };
}

function gpsOf(bus: BusVehicle, at: number, lat: number, lon: number): ExtractedEvent {
  const brg = bus.bearing === null ? null : Math.round(bus.bearing);
  return { k: 'gps', t: at, veh: bus.vehicleId, lat, lon, brg, stop: bus.stopId };
}

function passageOf(bus: BusVehicle, before: VehicleMemory, at: number): ExtractedEvent[] {
  if (before.stop === null || bus.stopId === before.stop) return [];
  return [
    {
      k: 'stn',
      t: at,
      ev: 'dep',
      trip: before.trip,
      route: before.route,
      dir: before.dir,
      veh: bus.vehicleId,
      stop: before.stop,
      next: bus.stopId,
      lo: before.lastReport,
      hi: at,
      exact: false,
    },
  ];
}

/** A new report of the same trip: a move, a passage, or one more report from the same place. */
function nextReport(bus: BusVehicle, before: VehicleMemory, at: number) {
  const lat = roundCoordinate(bus.latitude);
  const lon = roundCoordinate(bus.longitude);
  const events = passageOf(bus, before, at);
  const moved = metresBetween(before.lat, before.lon, lat, lon) >= SAME_PLACE_METRES;
  if (moved || bus.stopId !== before.stop) {
    events.push(gpsOf(bus, at, lat, lon));
    const place = moved ? { lat, lon, since: at, reports: 1 } : { reports: before.reports + 1 };
    return { memory: { ...before, ...place, stop: bus.stopId, lastReport: at }, events };
  }
  const reports = before.reports + 1;
  const checkpoint = at - before.lastHeld >= HELD_CHECKPOINT_SECONDS;
  if (checkpoint) {
    events.push({
      k: 'held',
      t: at,
      veh: bus.vehicleId,
      trip: before.trip,
      since: before.since,
      n: reports,
      lat: before.lat,
      lon: before.lon,
    });
  }
  const lastHeld = checkpoint ? at : before.lastHeld;
  return { memory: { ...before, reports, lastReport: at, lastHeld }, events };
}

/**
 * Bus Time GPS: a position only when the bus moved or names another next stop; a change of next
 * stop is a passage; a bus that keeps reporting the same place leaves checkpoints as proof.
 */
const busPositionsExtractor = extractorFor(
  busPositions,
  { mode: 'bus', restartsDaily: true },
  () => {
    const vehicles = new Map<string, VehicleMemory>();
    return (data) => {
      const events: ExtractedEvent[] = [];
      const seen = new Set<string>();
      for (const bus of data.vehicles) {
        seen.add(bus.vehicleId);
        const at = unixSeconds(bus.observedAt);
        const before = vehicles.get(bus.vehicleId);
        if (before !== undefined && at <= before.lastReport) continue;
        const sameTrip = before?.trip === bus.tripId && before.dir === directionText(bus.direction);
        const next =
          before !== undefined && sameTrip ? nextReport(bus, before, at) : startOf(bus, at);
        vehicles.set(bus.vehicleId, next.memory);
        events.push(...next.events);
      }
      for (const id of vehicles.keys()) if (!seen.has(id)) vehicles.delete(id);
      return events;
    };
  },
);

/** Bus Time predictions: sampled by horizon to measure their error against the passages. */
const busPredictionsExtractor = extractorFor(
  busTripUpdates,
  { mode: 'bus', restartsDaily: true },
  () => {
    const predictions = createPredictionSampler(BUS_HORIZON_BANDS, departureTime);
    return (data) => {
      // A cancelled trip will not pass its stops: its predictions are not judged.
      const views: TripView[] = data.trips
        .filter((trip) => !trip.cancelled)
        .map((trip) => ({
          tripId: trip.tripId,
          routeId: trip.routeId,
          direction: directionText(trip.direction),
          vehicleId: trip.vehicleId,
          stops: trip.stops,
        }));
      return predictions.observe(views, unixSeconds(data.feedTime));
    };
  },
);

export const busExtractors: readonly Extractor[] = [busPositionsExtractor, busPredictionsExtractor];
