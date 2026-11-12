import { describe, expect, it } from 'vitest';

import { gtfsIndexSchema } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { busPositionsSchema } from '../../../src/modules/data-platform/sources/westchester/bus-positions.js';
import { airportShuttleSources } from '../../../src/modules/data-platform/sources/shuttles/passio-airports.js';
import { airportShuttleTimetableSource } from '../../../src/modules/data-platform/sources/shuttles/passio-timetable.js';
import { accepted, capture, findSource } from '../regional/captures.js';

const context = { receivedAt: new Date('2026-11-11T03:20:10Z'), previous: undefined };

describe('Newark shuttle timetable', () => {
  it('joins the captured GPS trips to published route shapes', () => {
    const timetable = accepted(
      airportShuttleTimetableSource.parse(capture('shuttles', 'ewr-shuttle-gtfs.zip'), context),
    );
    const positions = accepted(
      findSource(airportShuttleSources, 'ewr-shuttle-positions').parse(
        capture('shuttles', 'ewr-shuttle-positions.pb'),
        context,
      ),
    );
    const index = gtfsIndexSchema.parse(timetable.data);
    const buses = busPositionsSchema.parse(positions.data).buses;
    expect(buses).toHaveLength(17);
    for (const bus of buses) {
      const trip = bus.tripId === null ? undefined : index.trips[bus.tripId];
      expect(trip?.route).toBe(bus.routeId);
      expect(trip?.shape && index.shapes?.[trip.shape]).toBeTruthy();
    }
  });
});
