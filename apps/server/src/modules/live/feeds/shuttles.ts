import { toInstant, type ExclusionReason, type LiveVehicle } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import { passioRouteSource } from '../../data-platform/sources/shuttles/passio-routes.js';
import { airportShuttleSources } from '../../data-platform/sources/shuttles/passio-airports.js';
import {
  passioGoSource,
  type PassioGoShuttles,
} from '../../data-platform/sources/shuttles/passio-go.js';
import type { BusPositions } from '../../data-platform/sources/westchester/bus-positions.js';
import { createMotionTracker, type Fix, type MotionTracker } from '../motion.js';
import { liveSource } from '../sources.js';
import { createTally, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS, movementOf } from './movement.js';

/**
 * Shuttles are shown as the shuttle of their operator, on the route the operator names when it
 * names one, with no destination and no timed stops: no shuttle feed publishes either, and the
 * card says so. Port Authority buses carry their published internal route number, so it can be
 * selected even when no passenger-facing name is available.
 */
interface ShuttleReport {
  readonly id: string;
  readonly name: string | null;
  readonly operator: string;
  readonly tripId: string | null;
  readonly route: { readonly id: string; readonly name: string } | null;
  readonly fix: Fix;
  readonly degrees: number | null;
  readonly kmh: number | null;
  readonly occupancy: LiveVehicle['occupancy'];
  /** Reports dated to the minute only: a speed computed between two of them would mislead. */
  readonly minuteOnly: boolean;
}

function shuttleOf(
  report: ShuttleReport,
  source: Pick<SourceDefinition, 'id' | 'freshness'>,
  context: FeedContext,
  tracker: MotionTracker,
): LiveVehicle | ExclusionReason {
  if (context.now.getTime() - report.fix.at > source.freshness.staleAfterMs) {
    return 'stale-position';
  }
  const { fix } = report;
  const movement = movementOf(tracker, report.id, fix, report);
  return {
    id: `shuttle:${source.id}:${report.id}`,
    mode: 'shuttle',
    sourceId: source.id,
    name: report.name,
    ...(report.tripId === null ? {} : { tripId: report.tripId }),
    line:
      report.route === null
        ? null
        : { id: report.route.id, name: report.route.name, longName: null },
    destination: null,
    position: {
      lat: fix.lat,
      lon: fix.lon,
      basis: 'gps',
      marginMeters: null,
      dataTime: toInstant(new Date(fix.at)),
      station: null,
      stall: null,
    },
    bearing: movement.bearing,
    speed: report.minuteOnly && movement.speed?.basis === 'computed' ? null : movement.speed,
    ...NO_MODE_DETAILS,
    operator: report.operator,
    occupancy: report.occupancy,
    stops: [],
    delaySeconds: null,
  };
}

const AIRPORTS = new Map([
  ['jfk-lga-shuttle-positions', 'Port Authority · JFK, LaGuardia'],
  ['ewr-shuttle-positions', 'Port Authority · Newark'],
]);

function airportReports(data: BusPositions, operator: string): ShuttleReport[] {
  return data.buses.map((bus) => ({
    id: bus.vehicleId,
    name: bus.label,
    operator,
    tripId: bus.tripId,
    route: { id: bus.routeId, name: bus.routeId },
    fix: { lat: bus.latitude, lon: bus.longitude, at: Date.parse(bus.observedAt) },
    degrees: bus.bearingDegrees,
    kmh: bus.speedMetresPerSecond === null ? null : bus.speedMetresPerSecond * 3.6,
    occupancy: null,
    minuteOnly: false,
  }));
}

/** The Passio GO systems by the names their riders know. */
const SYSTEMS: Readonly<Record<PassioGoShuttles['shuttles'][number]['system'], string>> = {
  nyu: 'NYU',
  'downtown-connection': 'Downtown Connection',
  'hutch-metro-center': 'Hutch Metro Center',
  liu: 'LIU',
  hoboken: 'Hoboken',
};

function passioReports(data: PassioGoShuttles): ShuttleReport[] {
  return data.shuttles.map((bus) => ({
    id: bus.vehicleId,
    name: bus.name,
    operator: SYSTEMS[bus.system],
    tripId: null,
    route: { id: bus.routeId, name: bus.route },
    fix: { lat: bus.latitude, lon: bus.longitude, at: Date.parse(bus.observedAt) },
    degrees: bus.courseDegrees,
    kmh: null,
    occupancy:
      bus.passengers === null || bus.capacity === null
        ? null
        : { passengers: bus.passengers, capacity: bus.capacity },
    minuteOnly: true,
  }));
}

function createShuttleFeed<T>(
  source: SourceDefinition<T>,
  reports: (data: T) => readonly ShuttleReport[],
): LiveModeFeed {
  const tracker = createMotionTracker();
  return {
    mode: 'shuttle',
    interestSourceIds: [source.id],
    async read(context) {
      const reading = await context.reader.read(source);
      const routes =
        source.id === passioGoSource.id ? await context.reader.read(passioRouteSource) : null;
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      for (const report of reading.data === undefined ? [] : reports(reading.data)) {
        const shown = shuttleOf(report, source, context, tracker);
        if (typeof shown === 'string') tally.add(shown);
        else vehicles.push(shown);
      }
      tracker.forget(context.now.getTime());
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          liveSource(source, reading),
          ...(routes === null ? [] : [liveSource(passioRouteSource, routes)]),
        ],
        liveSourceIds: [source.id],
      };
    },
  };
}

/** The Port Authority shuttles of JFK, LaGuardia and Newark: one feed per airport source. */
export const createAirportShuttleFeeds = (): LiveModeFeed[] =>
  airportShuttleSources.map((source) =>
    createShuttleFeed(source, (data) =>
      airportReports(data, AIRPORTS.get(source.id) ?? source.title),
    ),
  );

/** NYU, LIU, the Downtown Connection, Hutch Metro Center and Hoboken, with their counters. */
export const createPassioGoFeed = (): LiveModeFeed =>
  createShuttleFeed(passioGoSource, passioReports);
