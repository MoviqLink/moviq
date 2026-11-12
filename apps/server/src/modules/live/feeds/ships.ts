import type { ExclusionReason, LiveVehicle } from '@moviq/contracts';

import {
  openWatersSource,
  type HarbourTraffic,
} from '../../data-platform/sources/sea/open-waters.js';
import { normalBearing } from '../geo.js';
import { liveSource } from '../sources.js';
import { createTally, type FeedContext, type LiveModeFeed } from './feed.js';
import { NO_MODE_DETAILS, knotsToKmh } from './movement.js';

type Vessel = HarbourTraffic['vessels'][number];

/** The vessel as Explore shows it: with what its AIS sends, or why it is left out. */
function vesselOf(vessel: Vessel, context: FeedContext): LiveVehicle | ExclusionReason {
  const age = context.now.getTime() - Date.parse(vessel.observedAt);
  if (age > openWatersSource.freshness.staleAfterMs) return 'stale-position';
  // The course over ground is where it moves; the heading, where its bow points, stands in.
  const course = normalBearing(vessel.courseDegrees ?? vessel.headingDegrees);
  return {
    id: `ship:${vessel.mmsi}`,
    mode: 'ship',
    sourceId: openWatersSource.id,
    // A vessel that sends no name is known by its MMSI, the number every AIS station carries.
    name: vessel.name ?? vessel.mmsi,
    line: null,
    destination:
      vessel.destination === null ? null : { name: vessel.destination, basis: 'reported' },
    position: {
      lat: vessel.latitude,
      lon: vessel.longitude,
      basis: 'gps',
      marginMeters: null,
      dataTime: vessel.observedAt,
      station: null,
      stall: null,
    },
    bearing: course === null ? null : { degrees: course, basis: 'reported' },
    speed:
      vessel.speedKnots === null
        ? null
        : { kmh: knotsToKmh(vessel.speedKnots), basis: 'reported', overSeconds: null },
    ...NO_MODE_DETAILS,
    shipType: vessel.shipType,
    stops: [],
    delaySeconds: null,
  };
}

/**
 * Vessels in New York Harbor by AIS, the Staten Island and Governors Island ferries among them:
 * name, type, speed, course and the destination its crew typed, which may be out of date.
 */
export function createShipFeed(): LiveModeFeed {
  return {
    mode: 'ship',
    interestSourceIds: [openWatersSource.id],
    async read(context) {
      const reading = await context.reader.read(openWatersSource);
      const tally = createTally();
      const vehicles: LiveVehicle[] = [];
      for (const vessel of reading.data?.vessels ?? []) {
        const shown = vesselOf(vessel, context);
        if (typeof shown === 'string') tally.add(shown);
        else vehicles.push(shown);
      }
      return {
        vehicles,
        stations: [],
        excluded: tally.counts,
        sources: [liveSource(openWatersSource, reading)],
        liveSourceIds: [openWatersSource.id],
      };
    },
  };
}
