import type { LiveStation } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { adsbLolSource } from '../../src/modules/data-platform/sources/air/adsb-lol.js';
import { adsbRoutesSource } from '../../src/modules/data-platform/sources/air/adsb-routes.js';
import {
  citiBikeStationsSource,
  citiBikeStatusSource,
} from '../../src/modules/data-platform/sources/bikes/citi-bike.js';
import { createPositionEstimator } from '../../src/modules/live/estimation/estimator.js';
import { createAircraftFeed } from '../../src/modules/live/feeds/aircraft.js';
import { createBikeFeed } from '../../src/modules/live/feeds/bikes.js';
import type { FeedContext } from '../../src/modules/live/feeds/feed.js';
import { createTimetables } from '../../src/modules/live/timetable.js';
import { manualClock } from '../support/manual-clock.js';
import { parsedCapture, readerWith } from './reader.js';

async function contextAt(answers: ReadonlyMap<string, unknown>, at: string): Promise<FeedContext> {
  const reader = readerWith(answers, at);
  return {
    reader,
    now: new Date(at),
    timetables: await createTimetables(reader, manualClock(at)).current(),
    estimate: createPositionEstimator(),
  };
}

describe('bike share stations, from the capture of 02:29 UTC', () => {
  const at = '2026-11-11T02:29:40.000Z';
  const answers = new Map<string, unknown>([
    [
      citiBikeStationsSource.id,
      parsedCapture(citiBikeStationsSource, 'bikes/citi-bike-station-information.json', at),
    ],
    [
      citiBikeStatusSource.id,
      parsedCapture(citiBikeStatusSource, 'bikes/citi-bike-station-status.json', at),
    ],
  ]);

  it('joins each status to its place and leaves out stations not installed or not reporting', async () => {
    const reading = await createBikeFeed().read(await contextAt(answers, at));
    const stations = reading.stations.filter(
      (station): station is Extract<LiveStation, { mode: 'bike-station' }> =>
        station.mode === 'bike-station',
    );
    expect(stations.length).toBeGreaterThan(0);
    for (const station of stations) {
      expect(station.bikes).toBeGreaterThanOrEqual(station.ebikes ?? 0);
      expect(Date.parse(at) - Date.parse(station.reportedAt)).toBeLessThanOrEqual(15 * 60_000);
    }
    // The two that never reported and the one removed on 29/10/2026 are not installed.
    expect(Object.fromEntries(reading.excluded)).toEqual({ 'not-in-service': 3 });
    expect(stations.find((station) => !station.renting)).toBeDefined();
    expect(stations.length + [...reading.excluded.values()].reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('cites the sources by what they hold, without the operator brand, with the licence credit', async () => {
    const reading = await createBikeFeed().read(await contextAt(answers, at));
    expect(reading.sources.map((source) => source.title)).toEqual([
      'Bike share station status (GBFS)',
      'Bike share stations (GBFS)',
    ]);
    for (const source of reading.sources) {
      expect(source.title).not.toMatch(/citi/i);
      expect(source.attribution).toBe('Bike share data provided by Lyft Bikes and Scooters, LLC');
    }
  });
});

describe('the usual route of a flight', () => {
  it('names the airports its callsign usually flies, from the routes table', async () => {
    const at = '2026-11-11T02:52:40.000Z';
    const routes = parsedCapture(adsbRoutesSource, 'air/adsb-routes.csv.gz', at);
    const [callsign = '', airports = []] = Object.entries(routes.routes)[0] ?? [];
    const traffic = parsedCapture(adsbLolSource, 'air/adsb-lol-new-york.json', at);
    const [first] = traffic.aircraft;
    if (first === undefined) throw new Error('the capture holds aircraft');
    const renamed = { ...traffic, aircraft: [{ ...first, callsign }] };
    const reading = await createAircraftFeed().read(
      await contextAt(
        new Map<string, unknown>([
          [adsbLolSource.id, renamed],
          [adsbRoutesSource.id, routes],
        ]),
        at,
      ),
    );
    expect(reading.vehicles[0]).toMatchObject({ name: callsign, usualRoute: airports });
  });
});
