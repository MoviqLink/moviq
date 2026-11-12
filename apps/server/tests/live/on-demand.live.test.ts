import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { toNewYorkWallClockText } from '../../src/infrastructure/clock/new-york.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { aeroDataBoxCredential } from '../../src/modules/data-platform/on-demand/aerodatabox.js';
import { createOnDemandProviders } from '../../src/modules/data-platform/on-demand/index.js';

/**
 * One real request per on-demand provider. Transitous asks for moderate use, so this plans a
 * single trip. AeroDataBox spends 2 of its free plan's 400 monthly units each run, so run it only
 * when needed; without its key it fails with the variable to set.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const integrations = loaded.config.integrations;
const providers = createOnDemandProviders({
  http: createHttpClient(),
  clock: systemClock,
  integrations,
});

function explain(outcome: { ok: boolean; code?: string; detail?: string }): string {
  return outcome.ok ? '' : `${outcome.code ?? ''}: ${outcome.detail ?? ''}`;
}

describe('on-demand providers against the real services', () => {
  it('Transitous plans Union Square to Grand Central within the hour', async () => {
    const arriveBy = new Date(Date.now() + 60 * 60_000);
    const outcome = await providers.routing.plan({
      from: { label: 'Union Square', lat: 40.7359, lon: -73.9906, kind: 'address', stopId: null },
      to: { label: 'Grand Central', lat: 40.7527, lon: -73.9772, kind: 'address', stopId: null },
      arriveBy,
      modes: ['walk', 'subway', 'bus'],
      maxWalkMinutes: 15,
      stepFree: false,
      count: 3,
    });
    expect(outcome.ok, explain(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.length).toBeGreaterThan(0);
    for (const itinerary of outcome.value) {
      expect(itinerary.legs.at(-1)?.arriveAt.getTime()).toBeLessThanOrEqual(arriveBy.getTime());
    }
  }, 30_000);

  it('Transitous drives a taxi ride from 120 Broadway to Grand Central (regression)', async () => {
    const outcome = await providers.routing.plan({
      from: { label: '120 Broadway', lat: 40.7083, lon: -74.0109, kind: 'address', stopId: null },
      to: { label: 'Grand Central', lat: 40.7527, lon: -73.9772, kind: 'address', stopId: null },
      arriveBy: new Date(Date.now() + 90 * 60_000),
      modes: ['taxi'],
      maxWalkMinutes: 15,
      stepFree: false,
      count: 1,
    });
    expect(outcome.ok, explain(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.flatMap((itinerary) => itinerary.legs).map((leg) => leg.mode)).toContain(
      'taxi',
    );
  }, 30_000);

  it('NYC GeoSearch finds 120 Broadway', async () => {
    const outcome = await providers.geocoder.search('120 Broadway');
    expect(outcome.ok, explain(outcome)).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value[0]?.label).toMatch(/BROADWAY/i);
  }, 20_000);

  it('AeroDataBox finds American Airlines 100 from JFK today', async () => {
    const credential = aeroDataBoxCredential(integrations);
    const missing = 'missing' in credential ? credential.missing : [];
    expect(missing, `set ${missing.join(', ')} to validate this integration`).toEqual([]);
    const today = toNewYorkWallClockText(new Date()).slice(0, 10);
    const outcome = await providers.flights.find({ carrier: 'AA', number: '100', date: today });
    expect(outcome.ok, explain(outcome)).toBe(true);
  }, 20_000);
});
