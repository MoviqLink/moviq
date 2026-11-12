import { flightCheckSchema, flightSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  aeroDataBoxFact,
  aircraftFact,
  airportFact,
  type AeroDataBoxFact,
  type AircraftFact,
} from '../src/modules/journeys/flight-facts.js';
import { triangulate, type FlightFacts } from '../src/modules/journeys/flight-triangulation.js';
import {
  adbFlight,
  departureDelay,
  flightLive,
  passFlight,
  plane,
  SCHEDULED,
  sourced,
} from './support/flights.js';

const NOW = new Date('2026-11-11T15:00:30.000Z');
const AAL100 = { callSign: 'AAL100', hex: 'a9d286', airport: 'JFK' } as const;
const found = (flight = adbFlight()): AeroDataBoxFact => ({ kind: 'found', flight });
const failed: AeroDataBoxFact = aeroDataBoxFact(
  {
    ok: false,
    state: 'rate_limited',
    code: 'monthly-units',
    detail: "AeroDataBox's free plan has 0 of its 400 monthly units left above the reserve.",
  },
  NOW,
);

function facts(overrides: Partial<FlightFacts> = {}): FlightFacts {
  return {
    boardingPass: null,
    aerodatabox: found(),
    earlier: null,
    airport: airportFact(flightLive(), 'JFK'),
    aircraft: { kind: 'not-looked' },
    ...overrides,
  };
}

const seen = (overrides: Parameters<typeof plane>[0] = {}): AircraftFact =>
  aircraftFact(flightLive({ aircraft: [plane(overrides)] }), AAL100, new Date(SCHEDULED), NOW);

describe('triangulate', () => {
  it("plans from AeroDataBox's revised departure, with every reading as proof", () => {
    const revised = adbFlight({
      revisedDeparture: { at: '2026-11-11T15:40:00.000Z', kind: 'revised' },
    });
    const { check } = triangulate(facts({ aerodatabox: found(revised) }));
    expect(flightCheckSchema.parse(check)).toEqual(check);
    expect(check.departure).toEqual({
      at: '2026-11-11T15:40:00.000Z',
      basis: 'revised',
      sourceId: 'aerodatabox',
    });
    expect(check.evidence).toBe("Planned from AA 100's revised departure, 10:40 (AeroDataBox).");
    expect(check.readings.map((reading) => [reading.sourceId, reading.says])).toEqual([
      ['aerodatabox', 'Scheduled 10:20, revised 10:40, terminal 8, gate B12, status Expected.'],
      ['faa-airport-status', 'No FAA delay programme at JFK.'],
    ]);
    expect(check.discrepancies).toEqual([]);
  });

  it('says where the boarding pass and AeroDataBox disagree, with what each says', () => {
    const revised = adbFlight({
      revisedDeparture: { at: '2026-11-11T15:40:00.000Z', kind: 'revised' },
    });
    const { check, discrepancies } = triangulate(
      facts({
        boardingPass: passFlight('2026-11-11T15:05:00.000Z', '4'),
        aerodatabox: found(revised),
      }),
    );
    expect(check.departure?.basis).toBe('revised');
    expect(check.discrepancies).toEqual([
      'Your boarding pass says 10:05; AeroDataBox says 10:40 (revised).',
      'Your boarding pass says terminal 4; AeroDataBox says terminal 8.',
    ]);
    expect(discrepancies.map((item) => item.provenance.sourceId)).toEqual([
      'boarding-pass',
      'boarding-pass',
    ]);
    expect(check.readings.map((reading) => reading.sourceId)).toContain('boarding-pass');
  });

  it('falls back to the boarding pass while AeroDataBox has no units, and says why', () => {
    const { check } = triangulate(
      facts({ boardingPass: passFlight('2026-11-11T15:05:00.000Z'), aerodatabox: failed }),
    );
    expect(check.departure).toEqual({
      at: '2026-11-11T15:05:00.000Z',
      basis: 'boarding-pass',
      sourceId: 'boarding-pass',
    });
    expect(check.evidence).toBe(
      "Planned from the 10:05 departure on your boarding pass. AeroDataBox's free plan has 0 of " +
        'its 400 monthly units left above the reserve.',
    );
    expect(check.aerodatabox).toBeNull();
    expect(check.readings[0]).toMatchObject({
      sourceId: 'aerodatabox',
      provenance: { state: 'rate_limited' },
    });
  });

  it("keeps AeroDataBox's last answer, dated, while it cannot answer", () => {
    const { check } = triangulate(facts({ aerodatabox: failed, earlier: adbFlight() }));
    expect(check.departure?.basis).toBe('scheduled');
    expect(check.evidence).toContain(
      "Planned from AA 100's scheduled departure, 10:20 (AeroDataBox) in its answer of 07:55.",
    );
  });

  it('never makes a departure up: with no source it has none, and says so', () => {
    const { check } = triangulate(facts({ aerodatabox: failed }));
    expect(check.departure).toBeNull();
    expect(check.evidence).toContain('No source gives the departure');
  });

  it('notes an FAA departure delay that AeroDataBox does not show yet', () => {
    const { check } = triangulate(
      facts({ airport: airportFact(flightLive({ programs: [departureDelay] }), 'JFK') }),
    );
    expect(check.discrepancies).toEqual([
      'The FAA reports departure delays of 16 minutes to 30 minutes at JFK, increasing (weather). ' +
        'AeroDataBox still has AA 100 at 10:20.',
    ]);
  });

  it('takes the aircraft rolling in ADS-B as taxiing, and in the air as airborne', () => {
    const taxiing = triangulate(facts({ aircraft: seen({ groundSpeedKnots: 14 }) })).check;
    expect(taxiing.movement).toEqual({ phase: 'taxiing', sourceId: 'adsb-lol-new-york' });
    expect(triangulate(facts({ aircraft: seen() })).check.movement).toBeNull();
    const flying = triangulate(
      facts({ aircraft: seen({ onGround: false, altitudeFeet: 2400, latitude: 40.7 }) }),
    ).check;
    expect(flying.movement).toEqual({ phase: 'airborne', sourceId: 'adsb-lol-new-york' });
    expect(flying.discrepancies).toEqual([
      'ADS-B shows AAL100 airborne; AeroDataBox still says Expected.',
    ]);
    expect(flying.readings.at(-1)?.says).toBe('AAL100 is airborne at 2,400 ft, 3.5 NM from JFK.');
  });

  it("uses AeroDataBox's take-off once the flight has left", () => {
    const left = adbFlight({ takeOffAt: '2026-11-11T15:31:00.000Z', status: 'Departed' });
    const { check } = triangulate(facts({ aerodatabox: found(left) }));
    expect(check.departure).toMatchObject({ basis: 'take-off', at: '2026-11-11T15:31:00.000Z' });
    expect(check.movement).toEqual({ phase: 'airborne', sourceId: 'aerodatabox' });
    expect(check.evidence).toBe('AA 100 took off at 10:31 (AeroDataBox runway time).');
  });
});

describe('a flight kept before the triangulation', () => {
  it('still reads, with the facts it did not have as null', () => {
    const kept = {
      carrier: 'AA',
      number: '100',
      departureAt: SCHEDULED,
      airport: 'JFK',
      terminal: '8',
      status: 'Expected',
      provenance: sourced('aerodatabox'),
    };
    expect(flightSchema.parse(kept)).toEqual({
      ...kept,
      revisedDeparture: null,
      takeOffAt: null,
      gate: null,
      callSign: null,
      aircraftHex: null,
    });
  });
});

describe('the facts of a round', () => {
  it('looks in ADS-B only from an hour before the departure, and only for fresh positions', () => {
    const live = flightLive({ aircraft: [plane()] });
    const early = new Date('2026-11-11T14:00:00.000Z');
    expect(aircraftFact(live, AAL100, new Date(SCHEDULED), early)).toEqual({
      kind: 'not-looked',
    });
    expect(
      aircraftFact(live, { ...AAL100, callSign: null, hex: null }, new Date(SCHEDULED), NOW),
    ).toEqual({
      kind: 'not-looked',
    });
    const late = new Date('2026-11-11T15:05:00.000Z');
    expect(aircraftFact(live, AAL100, new Date(SCHEDULED), late)).toMatchObject({
      kind: 'not-seen',
    });
    expect(seen()).toMatchObject({ kind: 'seen', provenance: { ageSeconds: 30 } });
  });

  it('follows the aircraft on its way in before the departure, by its ICAO address', () => {
    const coming = plane({ callsign: 'AAL2213', onGround: false, altitudeFeet: 8000 });
    const live = flightLive({ aircraft: [coming] });
    const early = new Date('2026-11-11T13:00:00.000Z');
    const away = { ...coming, observedAt: '2026-11-11T13:00:00.000Z' };
    expect(
      aircraftFact(flightLive({ aircraft: [away] }), AAL100, new Date(SCHEDULED), early),
    ).toMatchObject({ kind: 'inbound', registration: 'N732AN', altitudeFeet: 8000 });
    expect(aircraftFact(live, AAL100, new Date(SCHEDULED), NOW)).toMatchObject({
      kind: 'inbound',
    });
    const parked = { ...away, onGround: true };
    expect(
      aircraftFact(flightLive({ aircraft: [parked] }), AAL100, new Date(SCHEDULED), early),
    ).toEqual({ kind: 'not-looked' });
  });

  it('reads adsb.fi when adsb.lol is down, and says when the FAA is down', () => {
    const live = flightLive({ lolDown: true });
    expect(aircraftFact(live, AAL100, new Date(SCHEDULED), NOW)).toMatchObject({
      kind: 'not-seen',
      provenance: { sourceId: 'adsb-fi-new-york' },
    });
    expect(airportFact(flightLive({ faaDown: true }), 'JFK')).toMatchObject({
      kind: 'down',
      provenance: { state: 'unavailable' },
    });
    expect(
      aeroDataBoxFact({ ok: true, value: null, provenance: sourced('aerodatabox') }, NOW),
    ).toMatchObject({
      kind: 'none',
    });
  });
});
