import { liveVehiclesResponseSchema } from '@moviq/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { subwaySources } from '../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { distanceMeters } from '../../src/modules/live/geo.js';
import { keepCityWarm } from '../../src/modules/live/warm.js';
import { liveCity } from './city.js';
import { subwayLater, TRAIN_A } from './feeds.js';

const aceFeed = subwaySources.find((definition) => definition.id === 'mta-subway-ace');
/** 190 St (`A05N`) in the subway timetable. */
const ST_190 = { lat: 40.859022, lon: -73.93418 };

/** Where the A train is drawn after leaving 181 St, with or without a build in between. */
async function trainAfterDeparture(warmBuild: boolean) {
  const city = await liveCity();
  try {
    await city.collect();
    if (warmBuild) await city.live.snapshot();
    city.clock.advance(60_000);
    if (aceFeed === undefined) throw new Error('no A, C and E feed');
    await city.collect([aceFeed], new Map([[aceFeed.id, subwayLater(60, 180)]]));
    const response = await city.app.request('/api/live/vehicles');
    const body = liveVehiclesResponseSchema.parse(await response.json());
    return body.vehicles.find((vehicle) => vehicle.id === `subway:${TRAIN_A}`)?.position;
  } finally {
    await city.dispose();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('keeping the city warm while nobody looks', () => {
  it('builds the city every 5 seconds, one build at a time, until stopped', async () => {
    vi.useFakeTimers();
    let builds = 0;
    const warm = keepCityWarm(
      {
        snapshot: () => {
          builds += 1;
          return Promise.resolve({
            generatedAt: '',
            modes: [],
            vehicles: [],
            stations: [],
            sources: [],
          });
        },
      },
      () => undefined,
    );
    expect(builds).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(builds).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(builds).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(builds).toBe(4);
    warm.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(builds).toBe(4);
  });

  it('reports a failed build and keeps going', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let builds = 0;
    const warm = keepCityWarm(
      {
        snapshot: () => {
          builds += 1;
          return Promise.reject(new Error('database closed'));
        },
      },
      (error) => errors.push(error),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    warm.stop();
    expect(builds).toBe(2);
    expect(errors).toHaveLength(2);
  });

  it('lets a screen opened after a departure find the train already between stations', async () => {
    // Without a build before the departure, the first screen sees the train at its next stop.
    const cold = await trainAfterDeparture(false);
    expect(cold?.station).toMatchObject({ id: 'A05N', status: 'heading' });
    expect(distanceMeters(ST_190, cold ?? ST_190)).toBeLessThan(30);
    // Built while nobody looked, the city saw it at 181 St and draws it on its way.
    const warm = await trainAfterDeparture(true);
    expect(warm?.station).toMatchObject({ id: 'A05N', status: 'heading' });
    expect(distanceMeters(ST_190, warm ?? ST_190)).toBeGreaterThan(100);
  });
});
