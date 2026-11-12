import { adsbFiSource } from '../../data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../../data-platform/sources/air/adsb-lol.js';
import { amtrakerSource } from '../../data-platform/sources/amtrak/amtraker.js';
import { nyWaterwayRealtimeSources } from '../../data-platform/sources/ferries/ny-waterway.js';
import { nycFerryRealtimeSources } from '../../data-platform/sources/ferries/nyc-ferry-realtime.js';
import { railRealtimeSources } from '../../data-platform/sources/regional/rail-realtime.js';
import { openWatersSource } from '../../data-platform/sources/sea/open-waters.js';
import { airportShuttleSources } from '../../data-platform/sources/shuttles/passio-airports.js';
import { passioGoSource } from '../../data-platform/sources/shuttles/passio-go.js';
import { beeLineSources } from '../../data-platform/sources/westchester/bee-line.js';
import { roundCoordinate, unixSeconds, type ExtractedEvent } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';
import { metresBetween } from './bus.js';

/** A position as every GPS source gives it, once normalised. */
export interface Fix {
  readonly veh: string;
  /** The trip and route it runs, when the source names both. */
  readonly trip: string | null;
  readonly route: string | null;
  readonly dir: string | null;
  readonly stop: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly brg: number | null;
  readonly at: number;
}

/** The same threshold as buses: GPS noise of a vehicle standing still stays within it. */
const MOVED_METRES = 15;

interface Memory {
  readonly trip: string | null;
  readonly route: string | null;
  readonly dir: string | null;
  readonly stop: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

/**
 * Follows vehicles that send their own position: `assign` when the trip or route changes, `gps`
 * when the vehicle moved 15 m or more or names another stop. A report not newer than the last
 * one is not written twice; vehicles no longer listed are forgotten.
 */
export function createFixTracker() {
  const vehicles = new Map<string, Memory>();
  return (fixes: readonly Fix[]): ExtractedEvent[] => {
    const events: ExtractedEvent[] = [];
    const seen = new Set<string>();
    for (const fix of fixes) {
      if (seen.has(fix.veh)) continue;
      seen.add(fix.veh);
      const before = vehicles.get(fix.veh);
      if (before !== undefined && fix.at <= before.at) continue;
      const lat = roundCoordinate(fix.lat);
      const lon = roundCoordinate(fix.lon);
      const changedTrip =
        before?.trip !== fix.trip || before.route !== fix.route || before.dir !== fix.dir;
      if (changedTrip && fix.trip !== null && fix.route !== null)
        events.push({
          k: 'assign',
          t: fix.at,
          veh: fix.veh,
          trip: fix.trip,
          route: fix.route,
          dir: fix.dir,
        });
      const moved =
        before === undefined || metresBetween(before.lat, before.lon, lat, lon) >= MOVED_METRES;
      if (moved || changedTrip || before.stop !== fix.stop) {
        const brg = fix.brg === null ? null : Math.round(fix.brg);
        events.push({ k: 'gps', t: fix.at, veh: fix.veh, lat, lon, brg, stop: fix.stop });
        vehicles.set(fix.veh, { ...fix, lat, lon });
      } else vehicles.set(fix.veh, { ...before, at: fix.at });
    }
    for (const id of vehicles.keys()) if (!seen.has(id)) vehicles.delete(id);
    return events;
  };
}

/** Positions only: the nightly reduction times subway and bus trips, not these. */
const POSITIONS = { mode: null, restartsDaily: true } as const;

const direction = (value: 0 | 1 | null): string | null => (value === null ? null : String(value));

/** LIRR and Metro-North: trains with GPS by position, the others by the stop they report. */
const railPositions = railRealtimeSources.map((definition) =>
  extractorFor(definition, POSITIONS, () => {
    const track = createFixTracker();
    return (data) =>
      track(
        data.trips.flatMap((trip): Fix[] => {
          const train = trip.train;
          if (train?.position.located !== 'gps') return [];
          const at = unixSeconds(train.observedAt ?? data.dataTime);
          const { latitude: lat, longitude: lon } = train.position;
          const veh = train.vehicleId ?? trip.trainNumber ?? trip.tripId;
          const dir = direction(trip.direction);
          return [
            {
              veh,
              trip: trip.tripId,
              route: trip.routeId,
              dir,
              stop: train.stopId,
              lat,
              lon,
              brg: null,
              at,
            },
          ];
        }),
      );
  }),
);

const amtrakPositions = extractorFor(amtrakerSource, POSITIONS, () => {
  const track = createFixTracker();
  return (data) =>
    track(
      data.trains.map((train) => ({
        veh: train.trainId,
        trip: train.trainId,
        route: train.route,
        dir: null,
        stop: train.nextStation?.code ?? null,
        lat: train.latitude,
        lon: train.longitude,
        brg: null,
        at: unixSeconds(train.observedAt),
      })),
    );
});

/** NYC Ferry and NY Waterway boats; their feeds name the trip but not the route. */
const [nycFerryPositions] = nycFerryRealtimeSources;
const ferryPositions = [nycFerryPositions, ...nyWaterwayRealtimeSources].map((definition) =>
  extractorFor(definition, POSITIONS, () => {
    const track = createFixTracker();
    return (data) =>
      track(
        data.vessels.map((vessel) => ({
          veh: vessel.vesselId,
          trip: null,
          route: null,
          dir: null,
          stop: null,
          lat: vessel.latitude,
          lon: vessel.longitude,
          brg: null,
          at: unixSeconds(vessel.observedAt),
        })),
      );
  }),
);

/** Bee-Line buses and the airport shuttles share one shape of positions. */
const [, beeLinePositions] = beeLineSources;
const busLikePositions = [beeLinePositions, ...airportShuttleSources].map((definition) =>
  extractorFor(definition, POSITIONS, () => {
    const track = createFixTracker();
    return (data) =>
      track(
        data.buses.map((bus) => ({
          veh: bus.vehicleId,
          trip: bus.tripId,
          route: bus.routeId,
          dir: direction(bus.direction),
          stop: bus.stopId,
          lat: bus.latitude,
          lon: bus.longitude,
          brg: bus.bearingDegrees,
          at: unixSeconds(bus.observedAt),
        })),
      );
  }),
);

const campusShuttles = extractorFor(passioGoSource, POSITIONS, () => {
  const track = createFixTracker();
  return (data) =>
    track(
      data.shuttles.map((shuttle) => ({
        veh: `${shuttle.system}:${shuttle.vehicleId}`,
        trip: null,
        route: null,
        dir: null,
        stop: null,
        lat: shuttle.latitude,
        lon: shuttle.longitude,
        brg: shuttle.courseDegrees,
        at: unixSeconds(shuttle.observedAt),
      })),
    );
});

/** Aircraft around the three airports, by their ICAO address. */
const aircraftPositions = [adsbLolSource, adsbFiSource].map((definition) =>
  extractorFor(definition, POSITIONS, () => {
    const track = createFixTracker();
    return (data) =>
      track(
        data.aircraft.map((plane) => ({
          veh: plane.hex,
          trip: null,
          route: null,
          dir: null,
          stop: null,
          lat: plane.latitude,
          lon: plane.longitude,
          brg: plane.trackDegrees,
          at: unixSeconds(plane.observedAt),
        })),
      );
  }),
);

/** Ships in the harbour, by their MMSI. */
const shipPositions = extractorFor(openWatersSource, POSITIONS, () => {
  const track = createFixTracker();
  return (data) =>
    track(
      data.vessels.map((ship) => ({
        veh: ship.mmsi,
        trip: null,
        route: null,
        dir: null,
        stop: null,
        lat: ship.latitude,
        lon: ship.longitude,
        brg: ship.courseDegrees,
        at: unixSeconds(ship.observedAt),
      })),
    );
});

export const positionExtractors: readonly Extractor[] = [
  ...railPositions,
  amtrakPositions,
  ...ferryPositions,
  ...busLikePositions,
  campusShuttles,
  ...aircraftPositions,
  shipPositions,
];
