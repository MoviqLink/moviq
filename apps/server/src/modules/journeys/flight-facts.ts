import type { Flight, Provenance } from '@moviq/contracts';

import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReading } from '../data-platform/reader.js';
import type { AirTraffic } from '../data-platform/sources/air/aircraft.js';
import type { NewYorkAirportStatus } from '../data-platform/sources/city/faa-airport-status.js';
import type { FlightFinder, ProviderOutcome } from './ports.js';

export type AirportProgram = NewYorkAirportStatus['airports'][number]['programs'][number];
type Aircraft = AirTraffic['aircraft'][number];

/** What the watch reads to check flights: AeroDataBox, the FAA's airport status and ADS-B. */
export interface FlightWatchSources {
  readonly flights: FlightFinder;
  readonly airportStatus: SourceDefinition<NewYorkAirportStatus>;
  /** The ADS-B provider and its stand-in, used when the first has nothing current. */
  readonly aircraft: readonly [SourceDefinition<AirTraffic>, SourceDefinition<AirTraffic>];
}

/** The readings of one watch round, shared by every journey with a flight. */
export interface FlightLive {
  readonly airportStatus: SourceReading<NewYorkAirportStatus>;
  readonly aircraft: readonly [SourceReading<AirTraffic>, SourceReading<AirTraffic>];
  /** Positions older than this are not taken as where an aircraft is. */
  readonly aircraftStaleAfterMs: number;
}

export type AeroDataBoxFact =
  | { readonly kind: 'found'; readonly flight: Flight }
  | { readonly kind: 'none'; readonly provenance: Provenance }
  | { readonly kind: 'failed'; readonly provenance: Provenance };

export type AirportFact =
  | {
      readonly kind: 'read';
      readonly programs: readonly AirportProgram[];
      readonly provenance: Provenance;
    }
  | { readonly kind: 'down'; readonly provenance: Provenance };

export type AircraftFact =
  | {
      readonly kind: 'seen';
      readonly callSign: string;
      readonly onGround: boolean;
      readonly altitudeFeet: number | null;
      readonly groundSpeedKnots: number | null;
      readonly distanceNm: number;
      readonly provenance: Provenance;
    }
  | { readonly kind: 'not-seen'; readonly callSign: string; readonly provenance: Provenance }
  /** The flight's aircraft, by its ICAO address, still in the air before the departure. */
  | {
      readonly kind: 'inbound';
      readonly registration: string | null;
      readonly altitudeFeet: number | null;
      readonly distanceNm: number;
      readonly provenance: Provenance;
    }
  | { readonly kind: 'down'; readonly provenance: Provenance }
  /** No call sign, or too early: an aircraft with the call sign may still be another flight. */
  | { readonly kind: 'not-looked' };

/** AeroDataBox's answer as a fact; a failure keeps its state and its sentence as evidence. */
export function aeroDataBoxFact(
  outcome: ProviderOutcome<Flight | null>,
  now: Date,
): AeroDataBoxFact {
  if (outcome.ok) {
    return outcome.value === null
      ? { kind: 'none', provenance: outcome.provenance }
      : { kind: 'found', flight: outcome.value };
  }
  return {
    kind: 'failed',
    provenance: {
      sourceId: 'aerodatabox',
      dataTime: null,
      receivedAt: now.toISOString(),
      ageSeconds: null,
      state: outcome.state,
      evidence: outcome.detail,
    },
  };
}

export function airportFact(live: FlightLive, airport: Flight['airport']): AirportFact {
  const { data, provenance } = live.airportStatus;
  if (data === undefined) return { kind: 'down', provenance };
  const programs = data.airports.find((entry) => entry.code === airport)?.programs ?? [];
  return { kind: 'read', programs, provenance };
}

/** ADS-B is looked at from an hour before the departure: earlier, the call sign may be inbound. */
const LOOK_FROM_MS = 60 * 60_000;

const AIRPORTS: Readonly<Record<Flight['airport'], readonly [number, number]>> = {
  JFK: [40.6413, -73.7781],
  LGA: [40.7769, -73.874],
  EWR: [40.6895, -74.1745],
};

/** The flight in ADS-B: its call sign, the ICAO address of its aircraft and its airport. */
export interface AircraftTarget {
  readonly callSign: string | null;
  readonly hex: string | null;
  readonly airport: Flight['airport'];
}

/**
 * The aircraft flying under the call sign, from an hour before the departure; before the
 * departure, also the flight's aircraft still in the air on its way in. Positions come from the
 * provider serving current ones.
 */
export function aircraftFact(
  live: FlightLive,
  target: AircraftTarget,
  departure: Date,
  now: Date,
): AircraftFact {
  const { callSign, hex } = target;
  const byCallSign = callSign !== null && now.getTime() >= departure.getTime() - LOOK_FROM_MS;
  const inbound = hex !== null && now.getTime() < departure.getTime();
  if (!byCallSign && !inbound) return { kind: 'not-looked' };
  const [first, second] = live.aircraft;
  const serving = first.data !== undefined && first.provenance.state !== 'stale' ? first : second;
  const reading = serving.data === undefined && first.data !== undefined ? first : serving;
  if (reading.data === undefined) return { kind: 'down', provenance: first.provenance };
  const fresh = reading.data.aircraft.filter(
    (plane) => now.getTime() - Date.parse(plane.observedAt) <= live.aircraftStaleAfterMs,
  );
  const placed = (plane: Aircraft) => ({
    altitudeFeet: plane.altitudeFeet,
    distanceNm: distanceNm([plane.latitude, plane.longitude], AIRPORTS[target.airport]),
    provenance: {
      ...reading.provenance,
      dataTime: plane.observedAt,
      ageSeconds: Math.max(0, Math.round((now.getTime() - Date.parse(plane.observedAt)) / 1000)),
    },
  });
  const flying = byCallSign
    ? fresh.find((plane) => plane.callsign?.toUpperCase() === callSign)
    : undefined;
  if (flying !== undefined && callSign !== null) {
    return {
      kind: 'seen',
      callSign,
      onGround: flying.onGround,
      groundSpeedKnots: flying.groundSpeedKnots,
      ...placed(flying),
    };
  }
  const coming = inbound ? fresh.find((plane) => plane.hex === hex && !plane.onGround) : undefined;
  if (coming !== undefined) {
    return { kind: 'inbound', registration: coming.registration, ...placed(coming) };
  }
  return byCallSign
    ? { kind: 'not-seen', callSign, provenance: reading.provenance }
    : { kind: 'not-looked' };
}

const EARTH_RADIUS_NM = 3440.065;

function distanceNm(a: readonly [number, number], b: readonly [number, number]): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b[0] - a[0]);
  const dLon = radians(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}
