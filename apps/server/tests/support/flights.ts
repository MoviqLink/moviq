import type { Flight, FlightCheck, Journey, Provenance } from '@moviq/contracts';
import { z } from 'zod';

import { adsbFiSource } from '../../src/modules/data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../../src/modules/data-platform/sources/air/adsb-lol.js';
import type { AirTraffic } from '../../src/modules/data-platform/sources/air/aircraft.js';
import { faaAirportStatusSource } from '../../src/modules/data-platform/sources/city/faa-airport-status.js';
import type {
  AirportProgram,
  FlightLive,
  FlightWatchSources,
} from '../../src/modules/journeys/flight-facts.js';
import { toItinerary } from '../../src/modules/journeys/itineraries.js';
import type { FlightFinder, ProviderOutcome } from '../../src/modules/journeys/ports.js';
import { planRequest, ROUTING_PROVENANCE, subwayTrip } from './journeys.js';

/** 10:20 in New York on 11/11/2026: AA 100 from JFK, as AeroDataBox gives it. */
export const SCHEDULED = '2026-11-11T15:20:00.000Z';

export const sourced = (sourceId: string, evidence = 'Read by the test.'): Provenance => ({
  sourceId,
  dataTime: '2026-11-11T12:55:00.000Z',
  receivedAt: '2026-11-11T13:00:00.000Z',
  ageSeconds: 300,
  state: 'healthy',
  evidence,
});

export function adbFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    carrier: 'AA',
    number: '100',
    departureAt: SCHEDULED,
    revisedDeparture: null,
    takeOffAt: null,
    airport: 'JFK',
    terminal: '8',
    gate: 'B12',
    status: 'Expected',
    callSign: 'AAL100',
    aircraftHex: 'a9d286',
    provenance: sourced('aerodatabox', 'AeroDataBox lists AA 100 departing JFK on 2026-11-11.'),
    ...overrides,
  };
}

/** The flight as the traveller read it from the boarding pass. */
export function passFlight(departureAt: string, terminal: string | null = '8'): Flight {
  return {
    ...adbFlight({
      departureAt,
      terminal,
      gate: null,
      status: null,
      callSign: null,
      aircraftHex: null,
    }),
    provenance: {
      sourceId: 'boarding-pass',
      dataTime: null,
      receivedAt: '2026-11-11T12:00:00.000Z',
      ageSeconds: null,
      state: 'healthy',
      evidence: 'The traveller read the 10:05 departure on the boarding pass.',
    },
  };
}

export const departureDelay: AirportProgram = {
  kind: 'delay',
  direction: 'departure',
  reason: 'weather',
  minimum: { text: '16 minutes', minutes: 16 },
  maximum: { text: '30 minutes', minutes: 30 },
  trend: 'Increasing',
};

type Plane = AirTraffic['aircraft'][number];

export function plane(overrides: Partial<Plane> = {}): Plane {
  return {
    located: 'gps',
    hex: 'a9d286',
    callsign: 'AAL100',
    registration: 'N732AN',
    aircraftType: 'B77W',
    latitude: 40.645,
    longitude: -73.785,
    onGround: true,
    altitudeFeet: null,
    groundSpeedKnots: 0,
    trackDegrees: 220,
    observedAt: '2026-11-11T15:00:00.000Z',
    ...overrides,
  };
}

/** One round of the FAA and both ADS-B providers, as the reader serves them. */
export function flightLive(
  options: {
    readonly programs?: readonly AirportProgram[];
    readonly faaDown?: boolean;
    readonly aircraft?: readonly Plane[];
    readonly lolDown?: boolean;
  } = {},
): FlightLive {
  const traffic = (aircraft: readonly Plane[]): AirTraffic => ({
    answeredAt: '2026-11-11T15:00:00.000Z',
    aircraft: [...aircraft],
    leftOut: 0,
  });
  const down = (sourceId: string): Provenance => ({
    ...sourced(sourceId, 'No usable data yet: timeout.'),
    state: 'unavailable',
  });
  return {
    airportStatus: options.faaDown
      ? { data: undefined, provenance: down('faa-airport-status') }
      : {
          data: {
            updatedAt: '2026-11-11T14:59:00.000Z',
            airports: [
              { code: 'JFK', programs: [...(options.programs ?? [])] },
              { code: 'LGA', programs: [] },
              { code: 'EWR', programs: [] },
            ],
          },
          provenance: sourced('faa-airport-status'),
        },
    aircraft: [
      options.lolDown
        ? { data: undefined, provenance: down('adsb-lol-new-york') }
        : { data: traffic(options.aircraft ?? []), provenance: sourced('adsb-lol-new-york') },
      { data: traffic([]), provenance: sourced('adsb-fi-new-york') },
    ],
    aircraftStaleAfterMs: 120_000,
  };
}

/** 07:30 in New York; AA 100 leaves JFK at 10:20, so the traveller must be there by 08:20. */
export const NOW = new Date('2026-11-11T12:30:00.000Z');
export const DEADLINE = '2026-11-11T13:20:00.000Z';

export function flightJourney(flight: Flight, watched: FlightCheck | null = null): Journey {
  return {
    id: 'j1',
    state: 'watching',
    request: { ...planRequest(DEADLINE), flight },
    // The ride is more than 45 min away, followed by its timetable: it arrives at 08:30.
    itinerary: toItinerary(
      subwayTrip('2026-11-11T13:20:00.000Z', '2026-11-11T13:30:00.000Z'),
      ROUTING_PROVENANCE,
      new Date(DEADLINE),
      { fareFor: () => null },
    ),
    createdAt: '2026-11-11T12:00:00.000Z',
    watch: {
      status: 'unknown',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not checked yet.',
      flight: watched,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}

export function finder(
  answer: ProviderOutcome<Flight | null>,
): FlightFinder & { asked: () => number } {
  let asked = 0;
  return {
    sourceId: 'aerodatabox',
    asked: () => asked,
    find: () => {
      asked += 1;
      return Promise.resolve(answer);
    },
  };
}

export const answered = (flight: Flight): ProviderOutcome<Flight | null> => ({
  ok: true,
  value: flight,
  provenance: flight.provenance,
});

export function sources(flights: FlightFinder): FlightWatchSources {
  return {
    flights,
    airportStatus: faaAirportStatusSource,
    aircraft: [adsbLolSource, adsbFiSource],
  };
}

/** Service alerts as the MTA source keeps them. */
export const alertsSchema = z.object({
  alerts: z.array(
    z.object({
      id: z.string(),
      header: z.string(),
      affected: z.array(
        z.object({ agencyId: z.string().nullable(), routeId: z.string().nullable() }),
      ),
      activePeriods: z.array(
        z.object({ start: z.string().nullable(), end: z.string().nullable() }),
      ),
    }),
  ),
});
