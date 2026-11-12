import {
  liveInterestResponseSchema,
  liveVehicleRouteSchema,
  liveVehiclesResponseSchema,
  type LiveVehicle,
  type LiveVehiclesResponse,
} from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { interestStore } from '../../src/modules/data-platform/interests.js';
import { busSources } from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { LIVE_DEFINITIONS, liveCity, type LiveCity } from './city.js';
import { busPositionsLater, busTripsWith, positionsWith, BUS_7110, BUS_8440 } from './feeds.js';

const [busPositions, busTripUpdates] = busSources;

let city: LiveCity;

beforeEach(async () => {
  city = await liveCity();
});

afterEach(async () => {
  await city.dispose();
});

async function vehicles(query = ''): Promise<LiveVehiclesResponse> {
  const response = await city.app.request(`/api/live/vehicles${query}`);
  expect(response.status).toBe(200);
  return liveVehiclesResponseSchema.parse(await response.json());
}

const ofMode = (body: LiveVehiclesResponse, mode: LiveVehicle['mode']) =>
  body.vehicles.filter((vehicle) => vehicle.mode === mode);
const summary = (body: LiveVehiclesResponse, mode: string) =>
  body.modes.find((candidate) => candidate.mode === mode);
const excluded = (body: LiveVehiclesResponse, mode: string) =>
  Object.fromEntries(summary(body, mode)?.excluded.map((row) => [row.reason, row.count]) ?? []);

describe('GET /api/live/vehicles with the captures of 11/11/2026', () => {
  it('returns only a current vehicle’s actual GTFS route when available', async () => {
    await city.collect();
    const bus = ofMode(await vehicles(), 'bus').find((item) => item.id === `bus:${BUS_8440}`);
    if (bus === undefined) throw new Error('expected captured bus');
    expect(bus.tripId).toBeTruthy();
    expect(
      (await city.live.routeDetails({ ...bus, tripId: 'not-this-trip' })).coordinates,
    ).toBeNull();
    const response = await city.app.request(
      `/api/live/route?vehicle=${encodeURIComponent(bus.id)}`,
    );
    expect(response.status).toBe(200);
    const body = liveVehicleRouteSchema.parse(await response.json());
    expect(body.coordinates?.length).toBeGreaterThan(2);
    const missing = await city.app.request('/api/live/route?vehicle=unknown');
    expect(liveVehicleRouteSchema.parse(await missing.json())).toEqual({ coordinates: null });
  });

  it('shows every captured bus that can be followed, with its line, destination and stops', async () => {
    await city.collect();
    const body = await vehicles();
    const buses = ofMode(body, 'bus');
    // Bee-Line, the other source of buses, has not answered in this test: the mode is partly late.
    expect(summary(body, 'bus')).toMatchObject({ status: 'degraded', shown: 39 });
    expect(excluded(body, 'bus')).toEqual({ 'no-stops-ahead': 1 });
    expect(buses.find((bus) => bus.id === `bus:${BUS_8440}`)).toMatchObject({
      name: '8440',
      line: { id: 'Q5', name: 'Q5', longName: 'Laurelton - Jamaica' },
      // Its trip is in the Queens timetable, so the headsign names it; 110 s after the report, the
      // position is estimated on the Q5 shape, with no margin until the recorder measures one.
      destination: { name: 'LAURELTON 233 ST via MERRICK BL', basis: 'timetable' },
      position: {
        basis: 'gps-plus',
        marginMeters: null,
        dataTime: '2026-11-11T01:05:10.000Z',
        station: null,
      },
      bearing: { basis: 'reported' },
      delaySeconds: -147,
      stops: [{ id: '500549', name: 'MERRICK BLVD/MONTAUK ST' }, {}, {}],
    });
    for (const bus of buses) {
      expect(bus.line).not.toBeNull();
      expect(bus.destination).not.toBeNull();
      expect(bus.stops.length).toBeGreaterThan(0);
      expect(bus.stops.every((stop) => (stop.arrival ?? stop.departure) !== null)).toBe(true);
    }
  });

  it('gives a bus no speed from one report, and computes it from two reports of the same bus', async () => {
    await city.collect();
    expect(ofMode(await vehicles(), 'bus').every((bus) => bus.speed === null)).toBe(true);
    city.clock.advance(30_000);
    await city.collect(
      [busPositions, busTripUpdates],
      new Map([[busPositions.id, busPositionsLater(30, 125)]]),
    );
    const bus = ofMode(await vehicles(), 'bus').find((found) => found.id === `bus:${BUS_8440}`);
    // 125 m north in 30 s is 15 km/h.
    expect(bus?.speed?.kmh).toBeCloseTo(15, 0);
    expect(bus?.speed).toMatchObject({ basis: 'computed', overSeconds: 30 });
    expect(bus?.position.dataTime).toBe('2026-11-11T01:05:40.000Z');
  });

  it('places subway trains by station, marked as predicted and without GPS or speed', async () => {
    await city.collect();
    const body = await vehicles();
    const trains = ofMode(body, 'subway');
    expect(summary(body, 'subway')).toMatchObject({ status: 'live', shown: 43 });
    expect(excluded(body, 'subway')).toEqual({
      'not-departed': 6,
      'stale-position': 3,
      'no-stops-ahead': 1,
      'no-line': 1,
    });
    expect(trains.find((train) => train.id === 'subway:109850_A..N55R')).toMatchObject({
      line: { id: 'A', name: 'A' },
      destination: { name: 'Inwood-207 St', basis: 'last-stop' },
      position: { basis: 'predicted', station: { id: 'A06N', name: '181 St', status: 'stopped' } },
      bearing: { basis: 'computed' },
      stops: [{ name: '190 St' }, { name: 'Dyckman St' }, {}],
    });
    for (const train of trains) {
      expect(train.position.basis).toBe('predicted');
      expect(train.position.station).not.toBeNull();
      expect(train.speed).toBeNull();
    }
  });

  it('leaves out and counts buses without a line, without predictions or without a destination', async () => {
    await city.collect();
    city.clock.advance(1_000);
    await city.collect(
      [busPositions, busTripUpdates],
      new Map([
        [
          busPositions.id,
          positionsWith({ unknownRoute: 'MTA NYCT_8443', noTrip: 'MTA NYCT_9775' }),
        ],
        [busTripUpdates.id, busTripsWith({ unknownLastStop: BUS_7110 })],
      ]),
    );
    const body = await vehicles();
    const ids = ofMode(body, 'bus').map((bus) => bus.id);
    expect(ids).not.toContain('bus:MTA NYCT_8443');
    expect(ids).not.toContain('bus:MTA NYCT_9775');
    expect(ids).not.toContain(`bus:${BUS_7110}`);
    expect(excluded(body, 'bus')).toEqual({
      'no-line': 1,
      'no-predictions': 1,
      'no-destination': 1,
      'no-stops-ahead': 1,
    });
    expect(summary(body, 'bus')?.shown).toBe(36);
  });

  it('says a source that never answered is down, and shows nothing of its mode', async () => {
    const fresh = await liveCity();
    try {
      await fresh.collect(
        undefined,
        new Map([
          [busPositions.id, { status: 503 }],
          [busTripUpdates.id, { status: 503 }],
        ]),
      );
      const response = await fresh.app.request('/api/live/vehicles');
      const body = liveVehiclesResponseSchema.parse(await response.json());
      expect(summary(body, 'bus')).toMatchObject({ status: 'unavailable', shown: 0 });
      const positions = body.sources.find((s) => s.provenance.sourceId === busPositions.id);
      expect(positions?.provenance.dataTime).toBeNull();
      expect(positions?.provenance.state).not.toBe('healthy');
      expect(positions?.provenance.evidence).not.toBe('');
      expect(summary(body, 'subway')?.status).toBe('live');
    } finally {
      await fresh.dispose();
    }
  });

  it('marks a mode unavailable once its live data runs out, and degraded while it ages', async () => {
    await city.collect();
    city.clock.advance(3 * 60_000);
    const ageing = await vehicles();
    expect(summary(ageing, 'bus')?.status).toBe('degraded');
    city.clock.advance(20 * 60_000);
    const gone = await vehicles();
    expect(summary(gone, 'bus')).toMatchObject({ status: 'unavailable', shown: 0 });
    const positions = gone.sources.find((s) => s.provenance.sourceId === busPositions.id);
    expect(positions?.provenance.state).toBe('unavailable');
  });

  it('gives JFK, LaGuardia and Newark their FAA status, and modes not read yet as unavailable', async () => {
    await city.collect();
    const body = await vehicles();
    expect(body.stations.map((station) => station.id).sort()).toEqual([
      'airport:EWR',
      'airport:JFK',
      'airport:LGA',
    ]);
    expect(body.stations.find((station) => station.id === 'airport:JFK')).toMatchObject({
      mode: 'airport',
      code: 'JFK',
      name: 'John F. Kennedy International',
      programs: [],
    });
    // Every mode has its sources; those not collected in this test have no data yet.
    const others = ['rail', 'ferry', 'shuttle', 'aircraft', 'ship', 'bike-station'];
    for (const mode of [...others, 'rail-station', 'micromobility']) {
      expect(summary(body, mode)).toMatchObject({ mode, status: 'unavailable', shown: 0 });
      expect(summary(body, mode)?.sourceIds.length).toBeGreaterThan(0);
    }
    expect(body.modes.every((mode) => mode.status !== 'not-connected')).toBe(true);
  });

  it('cites every source it read with its attribution and age', async () => {
    await city.collect();
    const body = await vehicles();
    const ids = body.sources.map((source) => source.provenance.sourceId);
    expect(ids).toEqual(
      expect.arrayContaining([busPositions.id, 'mta-gtfs-subway', 'faa-airport-status']),
    );
    const collected = new Set(LIVE_DEFINITIONS.map((definition) => definition.id));
    for (const source of body.sources) {
      expect(source.attribution).not.toBe('');
      if (collected.has(source.provenance.sourceId)) {
        expect(source.provenance.ageSeconds).not.toBeNull();
      }
    }
  });

  it('says which sources are files in force, such as timetables, and when they were published', async () => {
    await city.collect();
    const body = await vehicles();
    const kindOf = (id: string) =>
      body.sources.find((source) => source.provenance.sourceId === id)?.kind;
    expect(kindOf('mta-gtfs-subway')).toBe('static');
    expect(kindOf(busPositions.id)).toBe('realtime');
    expect(kindOf('faa-airport-status')).toBe('realtime');
    const source = (id: string) => body.sources.find((s) => s.provenance.sourceId === id);
    const timetable = source('mta-gtfs-subway');
    expect(timetable?.publishedAt).not.toBeNull();
    expect(timetable?.publishedAt).toBe(timetable?.provenance.dataTime);
    // Live data, and a file the provider does not date, carry no day of publication.
    expect(source(busPositions.id)?.publishedAt).toBeNull();
    expect(source('adsb-routes')?.publishedAt ?? null).toBeNull();
  });

  it('keeps to the box asked for, while the counts stay those of the whole city', async () => {
    await city.collect();
    const queens = await vehicles('?bbox=-73.80,40.64,-73.70,40.72');
    expect(queens.bbox).toEqual([-73.8, 40.64, -73.7, 40.72]);
    expect(queens.vehicles.length).toBeGreaterThan(0);
    for (const vehicle of queens.vehicles) {
      expect(vehicle.position.lon).toBeGreaterThanOrEqual(-73.8);
      expect(vehicle.position.lat).toBeLessThanOrEqual(40.72);
    }
    expect(summary(queens, 'bus')?.shown).toBe(39);
    for (const bad of ['?bbox=1,2,3', '?bbox=-73,41,-74,40', '?bbox=a,b,c,d']) {
      const response = await city.app.request(`/api/live/vehicles${bad}`);
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/live/interest', () => {
  it('keeps the live sources of the modes on screen hot for two minutes', async () => {
    const response = await city.app.request('/api/live/interest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modes: ['bus', 'subway', 'rail'] }),
    });
    expect(response.status).toBe(200);
    const body = liveInterestResponseSchema.parse(await response.json());
    expect(body.expiresAt).toBe('2026-11-11T01:09:00.000Z');
    const expected = [
      busPositions.id,
      busTripUpdates.id,
      'bee-line-positions',
      ...subwaySources.map((s) => s.id),
      'mta-lirr-realtime',
      'mta-metro-north-realtime',
      'amtraker-new-york',
    ];
    expect(body.sourceIds).toEqual(expected);
    expect([...(await interestStore.activeSourceIds(city.db, city.clock.now()))].sort()).toEqual(
      [...expected].sort(),
    );
    city.clock.advance(2 * 60_000);
    expect((await interestStore.activeSourceIds(city.db, city.clock.now())).size).toBe(0);
  });

  it('refuses a body without modes', async () => {
    for (const body of ['{}', '{"modes":[]}', '{"modes":["tram"]}', 'not json']) {
      const response = await city.app.request('/api/live/interest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(response.status).toBe(400);
    }
  });
});
