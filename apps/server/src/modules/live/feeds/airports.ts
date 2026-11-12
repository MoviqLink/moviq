import type { LiveStation } from '@moviq/contracts';

import { faaAirportStatusSource } from '../../data-platform/sources/city/faa-airport-status.js';
import { liveSource } from '../sources.js';
import { createTally, type LiveModeFeed } from './feed.js';

/**
 * The airport reference points of the FAA Airport Master Records (form 5010), in decimal
 * degrees: where the FAA places each airport, and where the map draws its status.
 */
const AIRPORTS = {
  JFK: { name: 'John F. Kennedy International', lat: 40.639928, lon: -73.778693 },
  LGA: { name: 'LaGuardia', lat: 40.77725, lon: -73.872611 },
  EWR: { name: 'Newark Liberty International', lat: 40.692481, lon: -74.168686 },
} as const;

/** JFK, LaGuardia and Newark with the FAA programs in force at each, none when there are none. */
export function createAirportFeed(): LiveModeFeed {
  return {
    mode: 'airport',
    interestSourceIds: [faaAirportStatusSource.id],
    async read(context) {
      const reading = await context.reader.read(faaAirportStatusSource);
      const airports = reading.data?.airports ?? [];
      const updatedAt = reading.data?.updatedAt;
      const stations: LiveStation[] =
        updatedAt === undefined
          ? []
          : airports.map((airport) => ({
              mode: 'airport',
              id: `airport:${airport.code}`,
              sourceId: faaAirportStatusSource.id,
              code: airport.code,
              ...AIRPORTS[airport.code],
              programs: airport.programs,
              updatedAt,
            }));
      return {
        vehicles: [],
        stations,
        excluded: createTally().counts,
        sources: [liveSource(faaAirportStatusSource, reading)],
        liveSourceIds: [faaAirportStatusSource.id],
      };
    },
  };
}
