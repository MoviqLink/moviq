import { movementSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { AIRPORTS } from '../../src/modules/airports/airports.js';
import {
  flightOfCallSign,
  airlineCodes,
  callSignOfFlight,
} from '../../src/modules/airports/call-signs.js';
import { matchBoard, type LiveTraffic } from '../../src/modules/airports/match.js';
import { estimateOf, phaseByGeometry, sight } from '../../src/modules/airports/movements.js';
import { provenance, ADSB_AT, jfkSnapshot, jfkTraffic, USUAL_ROUTES } from './support.js';

function traffic(): LiveTraffic {
  return {
    aircraft: jfkTraffic().aircraft,
    positions: provenance('adsb-lol-new-york', ADSB_AT),
    routes: USUAL_ROUTES,
    routesSourceId: 'adsb-routes',
  };
}

function board(direction: 'departures' | 'arrivals') {
  return matchBoard({
    airport: AIRPORTS.JFK,
    direction,
    board: jfkSnapshot(),
    traffic: traffic(),
    now: ADSB_AT,
  });
}

const live = (flights: ReturnType<typeof board>['flights'], number: string) =>
  flights.find((flight) => flight.number === number)?.live;

describe('call signs and flights', () => {
  it('turns an airline call sign into its flight, with the airlines of the board', () => {
    const airlines = airlineCodes(jfkSnapshot().departures);
    expect(flightOfCallSign('AAL100', airlines)).toBe('AA 100');
    expect(flightOfCallSign('EVA031', airlines)).toBe('BR 31');
    expect(flightOfCallSign('AIH587', airlines)).toBe('KJ 587');
    expect(flightOfCallSign('THY4YT', airlines)).toBeNull();
    expect(flightOfCallSign('N1102C', airlines)).toBeNull();
    expect(flightOfCallSign('EJA271', airlines)).toBeNull();
  });

  it("works out a flight's call sign when AeroDataBox gives none", () => {
    const t412 = jfkSnapshot().arrivals.find((flight) => flight.number === 'T4 12');
    expect(t412 === undefined ? undefined : callSignOfFlight(t412)).toBe('TTD12');
  });
});

describe('where an aircraft is against an airport', () => {
  const dal2093 = () => {
    const plane = jfkTraffic().aircraft.find((aircraft) => aircraft.callsign === 'DAL2093');
    if (plane === undefined) throw new Error('DAL2093 is in the ADS-B capture');
    return plane;
  };

  it('works out the landing of an aircraft heading for the runway from distance and speed', () => {
    // DAL2093 as captured, turned to head for JFK: 15.4 NM at 272 knots is 3.4 minutes.
    const plane = { ...dal2093(), trackDegrees: 298, altitudeFeet: 5000 };
    const sighting = sight(plane, AIRPORTS.JFK);
    expect(sighting.inbound).toBe(true);
    expect(phaseByGeometry(sighting)).toBe('approaching');
    const landing = estimateOf(sighting, 'approaching');
    expect(landing?.kind).toBe('landing');
    const minutes = (Date.parse(landing?.at ?? '') - Date.parse(plane.observedAt)) / 60_000;
    expect(minutes).toBeCloseTo((sighting.distanceNm / 272) * 60, 1);
    // Too high for a glide path there: not taken as approaching by geometry alone.
    expect(phaseByGeometry(sight({ ...plane, altitudeFeet: 9000 }, AIRPORTS.JFK))).toBeUndefined();
  });

  it('tells a take-off or landing run from taxiing and standing on the ground', () => {
    const jal3 = jfkTraffic().aircraft.find((aircraft) => aircraft.callsign === 'JAL3');
    if (jal3 === undefined) throw new Error('JAL3 is in the ADS-B capture');
    const at = (knots: number) =>
      phaseByGeometry(sight({ ...jal3, groundSpeedKnots: knots }, AIRPORTS.JFK));
    expect([at(2), at(19.5), at(120)]).toEqual(['on-ground', 'taxiing', 'on-runway']);
    expect(phaseByGeometry(sight(jal3, AIRPORTS.EWR))).toBeUndefined();
  });
});

describe('the board of the tests crossed with the real ADS-B capture of 11/11/2026', () => {
  it('shows each departure seen by ADS-B with its phase, and the take-off it worked out', () => {
    const { flights } = board('departures');
    const av245 = live(flights, 'AV 245');
    expect(av245).toMatchObject({
      callSign: 'AVA245',
      flight: 'AV 245',
      phase: 'departed',
      altitudeFeet: 1500,
      estimate: { kind: 'take-off' },
      provenance: { sourceId: 'adsb-lol-new-york' },
    });
    const takeOff = Date.parse(av245?.estimate?.at ?? '');
    expect(takeOff).toBeGreaterThan(Date.parse('2026-11-11T05:42:00Z'));
    expect(takeOff).toBeLessThan(ADSB_AT.getTime());
    // AeroDataBox still says Expected for it: ADS-B is what shows it airborne.
    expect(flights.find((flight) => flight.number === 'AV 245')?.status).toBe('Expected');
    expect(live(flights, 'TK 12')).toMatchObject({
      phase: 'on-ground',
      usualRoute: { airports: ['KJFK', 'LTFM'], otherEnd: 'LTFM', sourceId: 'adsb-routes' },
    });
    expect(live(flights, 'JL 3')?.phase).toBe('taxiing');
    // AeroDataBox says Departed (from the gate); ADS-B sees it still taxiing.
    expect(flights.find((flight) => flight.number === 'BR 31')).toMatchObject({
      status: 'Departed',
      live: { phase: 'taxiing' },
    });
    for (const flight of flights) {
      if (flight.live !== null) expect(movementSchema.parse(flight.live)).toEqual(flight.live);
    }
  });

  it('shows each arrival seen: on the ground, taxiing, or approaching', () => {
    const { flights } = board('arrivals');
    expect(live(flights, 'CM 804')?.phase).toBe('taxiing');
    expect(live(flights, 'AA 2118')?.phase).toBe('on-ground');
    expect(live(flights, 'AA 148')?.phase).toBe('on-ground');
    expect(live(flights, 'B6 924')?.phase).toBe('on-ground');
    expect(live(flights, 'B6 1024')).toMatchObject({
      phase: 'on-ground',
      usualRoute: { otherEnd: 'KFLL' },
    });
    // 15 NM out and not heading for the runway yet: approaching, with no landing time made up.
    expect(live(flights, 'DL 2093')).toMatchObject({ phase: 'approaching', estimate: null });
    const seen = flights.filter((flight) => flight.live !== null).map((flight) => flight.number);
    expect(seen.sort()).toEqual(['AA 148', 'AA 2118', 'B6 1024', 'B6 924', 'CM 804', 'DL 2093']);
  });

  it('says why each other aircraft moving at JFK matches no flight', () => {
    const { unmatched } = board('departures');
    const reasons = new Map(unmatched.map((plane) => [plane.callSign ?? plane.hex, plane.reason]));
    expect(reasons.get('AIH587')).toBe('off-schedule');
    expect(unmatched.find((plane) => plane.callSign === 'AIH587')).toMatchObject({
      flight: 'KJ 587',
      phase: 'taxiing',
    });
    expect(reasons.get('a0e431')).toBe('no-call-sign');
    expect(reasons.get('MX961')).toBe('not-a-flight');
    expect(reasons.get('JBU999')).toBe('not-on-board');
    for (const plane of unmatched) {
      expect(plane.distanceNm).toBeLessThanOrEqual(3);
      expect(plane.phase).not.toBe('approaching');
    }
    // Aircraft at LaGuardia and Newark are not JFK's.
    expect(reasons.has('AAL2794')).toBe(false);
    expect(reasons.has('.N976UY')).toBe(false);
  });

  it('without a board, lists the movements and says there is none to compare with', () => {
    const { flights, unmatched } = matchBoard({
      airport: AIRPORTS.JFK,
      direction: 'departures',
      board: null,
      traffic: traffic(),
      now: ADSB_AT,
    });
    expect(flights).toEqual([]);
    expect(unmatched.length).toBeGreaterThan(0);
    expect(new Set(unmatched.map((plane) => plane.reason))).toEqual(new Set(['no-board']));
    expect(unmatched.find((plane) => plane.callSign === 'AVA245')).toMatchObject({
      phase: 'departed',
    });
  });

  it('marks the usual route of a call sign that does not pass here', () => {
    const aircraft = jfkTraffic().aircraft.map((plane) =>
      plane.callsign === 'JBU999' ? { ...plane, callsign: 'AAL2077' } : plane,
    );
    // AA 2077 landed at JFK on the board, while its call sign usually flies Boston–Dallas.
    const { flights } = matchBoard({
      airport: AIRPORTS.JFK,
      direction: 'arrivals',
      board: jfkSnapshot(),
      traffic: { ...traffic(), aircraft },
      now: ADSB_AT,
    });
    expect(live(flights, 'AA 2077')?.usualRoute).toEqual({
      airports: ['KBOS', 'KDFW'],
      otherEnd: null,
      sourceId: 'adsb-routes',
    });
  });
});
