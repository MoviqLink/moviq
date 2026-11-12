import type { ExclusionReason, LiveVehicle } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import type { SourceReading } from '../../data-platform/reader.js';
import { adsbFiSource } from '../../data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../../data-platform/sources/air/adsb-lol.js';
import { adsbRoutesSource } from '../../data-platform/sources/air/adsb-routes.js';
import type { AirTraffic } from '../../data-platform/sources/air/aircraft.js';
import { normalBearing } from '../geo.js';
import { liveSource } from '../sources.js';
import { createTally, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS, knotsToKmh } from './movement.js';
import { readSlowly } from './slow-read.js';

type Aircraft = AirTraffic['aircraft'][number];

const FEET_TO_METERS = 0.3048;

/**
 * adsb.lol while it has something current to serve; adsb.fi, its stand-in, when adsb.lol has
 * nothing or only stale positions. Both are read: their states are shown either way.
 */
function servingOf(lol: SourceReading<AirTraffic>, fi: SourceReading<AirTraffic>) {
  if (lol.data !== undefined && lol.provenance.state !== 'stale') {
    return { source: adsbLolSource, data: lol.data };
  }
  if (fi.data !== undefined) return { source: adsbFiSource, data: fi.data };
  return lol.data === undefined ? undefined : { source: adsbLolSource, data: lol.data };
}

/** The aircraft as Explore shows it: with what it broadcasts, or why it is left out. */
function aircraftOf(
  plane: Aircraft,
  source: SourceDefinition<AirTraffic>,
  routes: Readonly<Record<string, readonly string[]>>,
  context: FeedContext,
): LiveVehicle | ExclusionReason {
  const age = context.now.getTime() - Date.parse(plane.observedAt);
  if (age > source.freshness.staleAfterMs) return 'stale-position';
  const route = plane.callsign === null ? undefined : routes[plane.callsign];
  const course = normalBearing(plane.trackDegrees);
  return {
    id: `aircraft:${plane.hex}`,
    mode: 'aircraft',
    sourceId: source.id,
    name: plane.callsign ?? plane.registration ?? plane.hex.toUpperCase(),
    line: null,
    destination: null,
    position: {
      lat: plane.latitude,
      lon: plane.longitude,
      basis: plane.located,
      marginMeters: null,
      dataTime: plane.observedAt,
      station: null,
      stall: null,
    },
    bearing: course === null ? null : { degrees: course, basis: 'reported' },
    speed:
      plane.groundSpeedKnots === null
        ? null
        : { kmh: knotsToKmh(plane.groundSpeedKnots), basis: 'reported', overSeconds: null },
    ...NO_MODE_DETAILS,
    altitudeMeters:
      plane.onGround || plane.altitudeFeet === null ? null : plane.altitudeFeet * FEET_TO_METERS,
    onGround: plane.onGround,
    usualRoute: route === undefined ? null : [...route],
    stops: [],
    delaySeconds: null,
  };
}

/**
 * Aircraft around JFK, LaGuardia and Newark by ADS-B: where each one is, how it was placed, its
 * altitude, speed and track as broadcast, and the usual route of its callsign, which is where
 * that callsign normally flies and not today's flight plan.
 */
export function createAircraftFeed(): LiveModeFeed {
  const readRoutes = readSlowly(adsbRoutesSource);
  return {
    mode: 'aircraft',
    interestSourceIds: [adsbLolSource.id, adsbFiSource.id],
    async read(context) {
      const [lol, fi, routes] = await Promise.all([
        context.reader.read(adsbLolSource),
        context.reader.read(adsbFiSource),
        readRoutes(context.reader, context.now),
      ]);
      const serving = servingOf(lol, fi);
      const usual = routes.data?.routes ?? {};
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      const planes =
        serving === undefined
          ? []
          : serving.data.aircraft.map((plane) => aircraftOf(plane, serving.source, usual, context));
      for (const shown of planes) {
        if (typeof shown === 'string') tally.add(shown);
        else vehicles.push(shown);
      }
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [
          liveSource(adsbLolSource, lol),
          liveSource(adsbFiSource, fi),
          liveSource(adsbRoutesSource, routes),
        ],
        liveSourceIds: [adsbLolSource.id, adsbFiSource.id],
      };
    },
  };
}
