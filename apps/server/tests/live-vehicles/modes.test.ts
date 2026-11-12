import {
  liveVehiclesResponseSchema,
  type LiveStation,
  type LiveVehicle,
  type LiveVehiclesResponse,
} from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { liveCity, OTHER_SOURCES, type LiveCity } from './city.js';

let city: LiveCity | undefined;

afterEach(async () => {
  await city?.dispose();
  city = undefined;
});

/** A fresh city at `at`, with these captures collected then. */
async function cityAt(
  at: string,
  sources: readonly SourceDefinition[],
  answers?: ReadonlyMap<string, { readonly status: number }>,
): Promise<LiveCity> {
  city = await liveCity(undefined, at);
  await city.collect(sources, answers);
  return city;
}

async function read(on: LiveCity, query = ''): Promise<LiveVehiclesResponse> {
  const response = await on.app.request(`/api/live/vehicles${query}`);
  expect(response.status).toBe(200);
  return liveVehiclesResponseSchema.parse(await response.json());
}

const ofMode = (body: LiveVehiclesResponse, mode: LiveVehicle['mode']) =>
  body.vehicles.filter((vehicle) => vehicle.mode === mode);
const placesOf = <M extends LiveStation['mode']>(body: LiveVehiclesResponse, mode: M) =>
  body.stations.filter((station): station is Extract<LiveStation, { mode: M }> => {
    return station.mode === mode;
  });
const summary = (body: LiveVehiclesResponse, mode: string) =>
  body.modes.find((candidate) => candidate.mode === mode);
const excluded = (body: LiveVehiclesResponse, mode: string) =>
  Object.fromEntries(summary(body, mode)?.excluded.map((row) => [row.reason, row.count]) ?? []);

describe('LIRR and Metro-North, from the captures of 02:21 UTC', () => {
  it('follows every train with its line, destination and timed stops, by GPS or by its stop', async () => {
    const body = await read(
      await cityAt('2026-11-11T02:22:10.000Z', [
        ...OTHER_SOURCES.lirr,
        ...OTHER_SOURCES.metroNorth,
      ]),
    );
    const trains = ofMode(body, 'rail');
    expect(summary(body, 'rail')?.shown).toBe(10);
    expect(excluded(body, 'rail')).toEqual({ 'stale-position': 1, 'not-departed': 3 });
    // The timetables give no shape, so a train with GPS is drawn where it reported.
    expect(trains.find((train) => train.id === 'rail:lirr:GO203_26_782')).toMatchObject({
      sourceId: 'mta-lirr-realtime',
      name: '7508',
      line: { id: '2', name: 'Hempstead Branch' },
      destination: { name: 'Hempstead', basis: 'timetable' },
      position: { basis: 'gps', marginMeters: null, station: null, stall: null },
      stops: [{ name: 'Floral Park' }, { name: 'Stewart Manor' }, { name: 'Nassau Boulevard' }],
    });
    // Metro-North trips do not join its timetable: the destination is the last stop, said so.
    expect(trains.find((train) => train.id === 'rail:mnr:3260344')).toMatchObject({
      name: '1391',
      line: { name: 'New Haven' },
      destination: { name: 'Grand Central', basis: 'last-stop' },
      position: { basis: 'predicted', station: { name: 'Port Chester' } },
      bearing: { basis: 'computed' },
      speed: null,
    });
    for (const train of trains) {
      expect(train.line).not.toBeNull();
      expect(train.destination).not.toBeNull();
      expect(train.stops.length).toBeGreaterThan(0);
      expect([train.altitudeMeters, train.usualRoute, train.shipType, train.occupancy]).toEqual([
        null,
        null,
        null,
        null,
      ]);
    }
  });
});

describe('PATH, NYC Ferry, aircraft and ships, each at the time of its capture', () => {
  it('shows the thirteen PATH stations with their next trains, soonest first', async () => {
    const body = await read(await cityAt('2026-11-11T02:25:00.000Z', OTHER_SOURCES.path));
    const stations = placesOf(body, 'rail-station');
    expect(stations).toHaveLength(13);
    expect(body.vehicles).toEqual([]);
    for (const station of stations) {
      expect(station.network).toBe('PATH');
      const times = station.arrivals.map((arrival) => Date.parse(arrival.arrival));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times.every((time) => time >= Date.parse('2026-11-11T02:24:30.000Z'))).toBe(true);
    }
    expect(
      stations.find((station) => station.id === 'rail-station:path:JSQ')?.arrivals,
    ).toHaveLength(5);
  });

  it('follows NYC Ferry boats with their route, headsign, stops and reported speed', async () => {
    const body = await read(await cityAt('2026-11-11T02:28:00.000Z', OTHER_SOURCES.nycFerry));
    const boats = ofMode(body, 'ferry');
    expect(boats).toHaveLength(4);
    expect(boats.find((boat) => boat.name === 'H109')).toMatchObject({
      line: { id: 'RS' },
      destination: { name: 'Wall St./Pier 11', basis: 'timetable' },
      position: { basis: 'gps' },
      speed: { basis: 'reported', overSeconds: null },
      stops: [{ name: 'Wall St/Pier 11' }],
    });
    expect(boats.find((boat) => boat.name === 'H109')?.speed?.kmh).toBeCloseTo(39.6, 1);
  });

  it('shows aircraft as broadcast and ships as their AIS sends them', async () => {
    const at = '2026-11-11T02:52:40.000Z';
    const body = await read(await cityAt(at, [...OTHER_SOURCES.air, ...OTHER_SOURCES.sea]));
    const planes = ofMode(body, 'aircraft');
    expect(planes).toHaveLength(9);
    expect(planes.find((plane) => plane.name === 'UAL1800')).toMatchObject({
      sourceId: 'adsb-lol-new-york',
      line: null,
      destination: null,
      position: { basis: 'gps', dataTime: '2026-11-11T02:51:51.848Z' },
      bearing: { degrees: 284.5, basis: 'reported' },
      onGround: false,
      stops: [],
    });
    expect(planes.find((plane) => plane.name === 'UAL1800')?.altitudeMeters).toBeCloseTo(3383.3, 1);
    expect(planes.find((plane) => plane.name === 'UAL54')).toMatchObject({
      altitudeMeters: null,
      onGround: true,
    });
    const ships = ofMode(body, 'ship');
    expect(ships).toHaveLength(12);
    expect(ships.find((ship) => ship.id === 'ship:368098930')).toMatchObject({
      name: 'DREAM BOAT',
      destination: { name: 'BROOKLYN NY', basis: 'reported' },
      shipType: 60,
      bearing: { basis: 'reported' },
      speed: { basis: 'reported' },
    });
  });

  it('draws the aircraft of adsb.fi when adsb.lol has nothing to serve', async () => {
    const at = '2026-11-11T02:52:40.000Z';
    const down = new Map([['adsb-lol-new-york', { status: 503 }]]);
    const body = await read(await cityAt(at, OTHER_SOURCES.air, down));
    const planes = ofMode(body, 'aircraft');
    expect(planes.length).toBeGreaterThan(0);
    expect(planes.every((plane) => plane.sourceId === 'adsb-fi-new-york')).toBe(true);
  });

  it('answers only the modes asked for, and refuses a mode it does not know', async () => {
    const on = await cityAt('2026-11-11T02:52:40.000Z', [
      ...OTHER_SOURCES.air,
      ...OTHER_SOURCES.sea,
    ]);
    const ships = await read(on, '?modes=ship');
    expect(ships.vehicles.map((vehicle) => vehicle.mode)).toEqual(Array(12).fill('ship'));
    expect(summary(ships, 'aircraft')?.shown).toBe(9);
    expect((await read(on, '?modes=')).vehicles).toEqual([]);
    expect((await on.app.request('/api/live/vehicles?modes=ship,tram')).status).toBe(400);
  });
});

describe('the sources without timed stops, shuttles and micromobility, at 03:23 UTC', () => {
  const sources = [
    ...OTHER_SOURCES.untimed,
    ...OTHER_SOURCES.shuttles,
    ...OTHER_SOURCES.micromobility,
  ];

  it('counts Bee-Line buses, NY Waterway boats and Amtrak trains without drawing them', async () => {
    const body = await read(await cityAt('2026-11-11T03:23:00.000Z', sources));
    expect(excluded(body, 'bus')).toEqual({ 'no-predictions': 35 });
    expect(excluded(body, 'ferry')).toEqual({ 'no-predictions': 2 });
    expect(excluded(body, 'rail')).toEqual({ 'no-predictions': 5 });
    expect(body.vehicles.some((vehicle) => vehicle.mode !== 'shuttle')).toBe(false);
    const amtraker = body.sources.find((s) => s.provenance.sourceId === 'amtraker-new-york');
    expect(amtraker?.attribution).toBe('Train data from Amtraker (https://amtraker.com)');
  });

  it('shows shuttles as their operator runs them, with the counter where there is one', async () => {
    const body = await read(await cityAt('2026-11-11T03:23:00.000Z', sources));
    const shuttles = ofMode(body, 'shuttle');
    expect(shuttles).toHaveLength(33);
    expect(
      shuttles.find((bus) => bus.id === 'shuttle:jfk-lga-shuttle-positions:13697'),
    ).toMatchObject({
      name: '603',
      operator: 'Port Authority · JFK, LaGuardia',
      line: { id: '3688', name: '3688' },
      destination: null,
      bearing: { degrees: 227, basis: 'reported' },
      speed: { basis: 'reported' },
      stops: [],
    });
    // Passio GO dates its reports to the minute: no speed is computed from them.
    expect(shuttles.find((bus) => bus.id === 'shuttle:passio-go-shuttles:401766')).toMatchObject({
      name: '2146',
      operator: 'NYU',
      line: { name: 'Route A' },
      occupancy: { passengers: 64, capacity: 64 },
      speed: null,
    });
  });

  it('shows parked scooters and bikes free to rent, and which ones keep their ids', async () => {
    const body = await read(await cityAt('2026-11-11T03:23:00.000Z', sources));
    const parked = placesOf(body, 'micromobility');
    expect(parked).toHaveLength(34);
    expect(excluded(body, 'micromobility')).toEqual({ 'not-in-service': 5 });
    expect(new Set(parked.filter((one) => one.stableId).map((one) => one.name))).toEqual(
      new Set(['Veo']),
    );
    expect(parked.find((one) => one.name === 'Lime')).toMatchObject({
      kind: 'scooter',
      stableId: false,
      reportedAt: '2026-11-11T03:20:28.000Z',
    });
  });
});
