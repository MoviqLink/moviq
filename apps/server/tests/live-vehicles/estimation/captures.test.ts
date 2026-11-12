import { liveVehiclesResponseSchema, type LiveVehicle } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { subwaySources } from '../../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { createPositionEstimator } from '../../../src/modules/live/estimation/estimator.js';
import { distanceMeters } from '../../../src/modules/live/geo.js';
import { liveCity, type LiveCity } from '../city.js';
import { subwayLater, TRAIN_A } from '../feeds.js';
import { RUN_TIME, statisticsWith } from './statistics.js';

/** The 14 captured buses whose trips the Queens timetable capture holds, with their shapes. */
const QUEENS_BUSES = new Set(
  [8427, 8428, 8433, 8434, 8440, 8441, 8442, 8443, 8446, 8447, 8448, 8460, 8462, 8465].map(
    (fleet) => `bus:MTA NYCT_${String(fleet)}`,
  ),
);

const [aceFeed] = subwaySources;
/** 181 St and 190 St northbound, as the subway timetable places them. */
const ST_181 = { lat: 40.851695, lon: -73.937969 };
const ST_190 = { lat: 40.859022, lon: -73.93418 };

let city: LiveCity | undefined;

afterEach(async () => {
  await city?.dispose();
  city = undefined;
});

async function vehicles(open: LiveCity): Promise<LiveVehicle[]> {
  const response = await open.app.request('/api/live/vehicles');
  return liveVehiclesResponseSchema.parse(await response.json()).vehicles;
}

describe('estimation over the captures of 11/11/2026', () => {
  it('draws Queens buses on the shape of their trip, and the others where they reported', async () => {
    city = await liveCity();
    await city.collect();
    const buses = (await vehicles(city)).filter((vehicle) => vehicle.mode === 'bus');
    expect(buses.filter((bus) => QUEENS_BUSES.has(bus.id))).toHaveLength(14);
    // Each was reported within 100 m of its shape and, two minutes on, is estimated along it;
    // a bus whose trip has no shape in the captures is drawn where it reported, as `gps`.
    for (const bus of buses) {
      expect(bus.position.basis).toBe(QUEENS_BUSES.has(bus.id) ? 'gps-plus' : 'gps');
      expect(bus.position.marginMeters).toBeNull();
    }
  });

  it('places a train that left 181 St between it and 190 St, on the shape of its path', async () => {
    city = await liveCity();
    await city.collect();
    const before = (await vehicles(city)).find((vehicle) => vehicle.id === `subway:${TRAIN_A}`);
    expect(before?.position.station).toEqual({ id: 'A06N', name: '181 St', status: 'stopped' });
    city.clock.advance(60_000);
    if (!aceFeed) throw new Error('no A, C and E feed');
    await city.collect([aceFeed], new Map([[aceFeed.id, subwayLater(60, 180)]]));
    const train = (await vehicles(city)).find((vehicle) => vehicle.id === `subway:${TRAIN_A}`);
    expect(train?.position).toMatchObject({
      basis: 'predicted',
      marginMeters: null,
      dataTime: '2026-11-11T01:06:03.000Z',
      station: { id: 'A05N', name: '190 St', status: 'heading' },
    });
    const response = await city.app.request(
      `/api/live/route?vehicle=${encodeURIComponent(`subway:${TRAIN_A}`)}`,
    );
    const route = (await response.json()) as { coordinates: unknown[] | null };
    expect(route.coordinates?.length).toBeGreaterThan(2);
    const position = train?.position ?? ST_181;
    const segment = distanceMeters(ST_181, ST_190);
    expect(distanceMeters(ST_181, position)).toBeGreaterThan(0.2 * segment);
    expect(distanceMeters(position, ST_190)).toBeGreaterThan(0.05 * segment);
    expect(distanceMeters(ST_181, position) + distanceMeters(position, ST_190)).toBeLessThan(
      segment * 1.05,
    );
  });

  it('returns only verified partial routes for a shared W track and a diverted R', async () => {
    city = await liveCity();
    await city.collect();
    const template = (await vehicles(city)).find((vehicle) => vehicle.mode === 'subway');
    if (template === undefined) throw new Error('expected captured subway train');
    for (const [trip, station, stops] of [
      [
        '133800_W..N',
        { id: 'R08N', name: '39 Av', lat: 40.752882, lon: -73.932755 },
        ['R06N', 'R05N', 'R04N'],
      ],
      [
        '137200_R..N',
        { id: 'D26N', name: 'Prospect Park', lat: 40.661614, lon: -73.962246 },
        ['D25N', 'D24N', 'R30N'],
      ],
    ] as const) {
      const result = await city.live.routeDetails({
        ...template,
        id: `subway:${trip}`,
        position: {
          ...template.position,
          lat: station.lat,
          lon: station.lon,
          station: { id: station.id, name: station.name, status: 'stopped' },
        },
        stops: stops.map((id) => ({
          id,
          name: id,
          arrival: '2026-11-11T02:00:00.000Z',
          departure: null,
        })),
      });
      expect(result.coverage).toBe('partial');
      expect(result.coordinates?.length).toBeGreaterThan(2);
    }
  });

  it('gives that train a margin once the recorder has measured the segment', async () => {
    // A 181 St to 190 St run written by hand, scaled to the 3 to 4 minutes of this capture.
    const runTime = { ...RUN_TIME, seconds: RUN_TIME.seconds.map((seconds) => seconds * 2) };
    city = await liveCity(createPositionEstimator(statisticsWith({ runTime })));
    await city.collect();
    // The estimator learns from what Explore is shown: the train at 181 St first.
    await vehicles(city);
    city.clock.advance(60_000);
    if (!aceFeed) throw new Error('no A, C and E feed');
    await city.collect([aceFeed], new Map([[aceFeed.id, subwayLater(60, 180)]]));
    const train = (await vehicles(city)).find((vehicle) => vehicle.id === `subway:${TRAIN_A}`);
    expect(train?.position.marginMeters).toBeGreaterThan(0);
  });
});
