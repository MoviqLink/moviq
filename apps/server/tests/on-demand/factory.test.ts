import { describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { createOnDemandProviders } from '../../src/modules/data-platform/on-demand/index.js';
import { omnyFareRules } from '../../src/modules/journeys/fares/omny.js';
import { fixedClock, stubHttp } from './support.js';

describe('createOnDemandProviders', () => {
  it('builds the four providers, and without the flight key asks nobody for flights', async () => {
    const { http, sent } = stubHttp({ status: 500 });
    const providers = createOnDemandProviders({
      http,
      clock: fixedClock('2026-11-11T02:00:00Z'),
      integrations: resolveIntegrations({}),
    });
    expect([
      providers.routing.sourceId,
      providers.geocoder.sourceId,
      providers.flights.sourceId,
    ]).toEqual(['transitous', 'nyc-geosearch', 'aerodatabox']);
    expect(providers.fares).toBe(omnyFareRules);
    const flight = await providers.flights.find({
      carrier: 'AA',
      number: '100',
      date: '2026-11-11',
    });
    expect(flight).toMatchObject({ ok: false, state: 'misconfigured', code: 'missing-credential' });
    expect(sent).toEqual([]);
  });

  it('hands the configured key to the flight finder', async () => {
    const { http, sent } = stubHttp({ status: 204 });
    const providers = createOnDemandProviders({
      http,
      clock: fixedClock('2026-11-11T02:00:00Z'),
      integrations: resolveIntegrations({ AERODATABOX_KEY: 'test-key' }),
    });
    const flight = await providers.flights.find({
      carrier: 'AA',
      number: '100',
      date: '2026-11-11',
    });
    expect(flight).toMatchObject({ ok: true, value: null });
    expect(sent[0]?.headers.get('x-rapidapi-key')).toBe('test-key');
  });
});
