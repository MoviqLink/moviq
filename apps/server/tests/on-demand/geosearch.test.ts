import { placeSchema, provenanceSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import {
  createNycGeoSearch,
  searchUrl,
} from '../../src/modules/data-platform/on-demand/geosearch.js';
import { capture, fixedClock, stubHttp, type StubAnswer } from './support.js';

const matches = capture('geosearch-120-broadway.json');
const noMatch = capture('geosearch-no-match.json');
const clock = fixedClock('2026-11-11T01:55:55Z');

async function search(answer: StubAnswer, text = '120 Broadway') {
  const { http, sent } = stubHttp(answer);
  const outcome = await createNycGeoSearch({ http, clock, size: 3 }).search(text);
  return { outcome, sent };
}

describe('NYC GeoSearch', () => {
  it('accepts the real capture: addresses best first, each point once', async () => {
    const { outcome } = await search({ body: matches });
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.value).toEqual([
      {
        label: '120 BROADWAY, New York, NY, USA',
        lat: 40.708233,
        lon: -74.010542,
        kind: 'address',
        stopId: null,
      },
      {
        label: '120 EAST BROADWAY, New York, NY, USA',
        lat: 40.714049,
        lon: -73.992285,
        kind: 'address',
        stopId: null,
      },
    ]);
    expect(outcome.provenance).toEqual({
      sourceId: 'nyc-geosearch',
      dataTime: '2026-11-11T01:55:54.067Z',
      receivedAt: '2026-11-11T01:55:55.000Z',
      ageSeconds: 1,
      state: 'healthy',
      evidence: 'NYC GeoSearch matched 2 addresses, best first.',
    });
  });

  it('keeps the places and their provenance through JSON in the public contract', async () => {
    const { outcome } = await search({ body: matches });
    if (!outcome.ok) throw new Error(outcome.detail);
    const stored: unknown = JSON.parse(JSON.stringify(outcome));
    expect(placeSchema.array().parse((stored as { value: unknown }).value)).toEqual(outcome.value);
    expect(provenanceSchema.parse((stored as { provenance: unknown }).provenance)).toEqual(
      outcome.provenance,
    );
  });

  it('never repeats the text searched in what it reports', async () => {
    const found = await search({ body: matches }, '120 Broadway apt 4');
    const missing = await search({ body: noMatch }, '120 Broadway apt 4');
    expect(JSON.stringify([found.outcome, missing.outcome])).not.toMatch(/apt 4/i);
  });

  it('leaves out matches outside the New York area', async () => {
    const answer = JSON.parse(matches) as {
      features: { geometry: { coordinates: number[] } }[];
    };
    const [first] = answer.features;
    if (first !== undefined) first.geometry.coordinates = [-71.06, 42.36];
    const { outcome } = await search({ body: JSON.stringify(answer) });
    expect(outcome.ok && outcome.value.map((place) => place.label)).toEqual([
      "120 B'WAY, New York, NY, USA",
      '120 EAST BROADWAY, New York, NY, USA',
    ]);
  });

  describe('gives each known failure its code', () => {
    const failures: readonly (readonly [string, string, StubAnswer])[] = [
      ['no-match', 'unavailable', { body: noMatch }],
      ['provider-error', 'unavailable', { status: 502, body: '<html>Bad gateway</html>' }],
      ['rate-limited', 'rate_limited', { status: 429 }],
      ['not-json', 'unavailable', { body: '<!doctype html><title>Maintenance</title>' }],
      ['unexpected-shape', 'misconfigured', { body: '{"type":"FeatureCollection"}' }],
    ];
    it.each(failures)('%s', async (code, state, answer) => {
      const { outcome } = await search(answer);
      expect(outcome).toMatchObject({ ok: false, code, state });
    });

    it('empty-text, without asking GeoSearch', async () => {
      const { outcome, sent } = await search({ body: matches }, '   ');
      expect(outcome).toMatchObject({ ok: false, code: 'empty-text' });
      expect(sent).toEqual([]);
    });
  });

  it('asks the search endpoint with the trimmed text and the generic identity', async () => {
    const { sent } = await search({ body: matches }, '  120 Broadway ');
    expect(sent[0]?.url).toBe(
      'https://geosearch.planninglabs.nyc/v2/search?text=120+Broadway&size=3',
    );
    expect(sent[0]?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
    expect(searchUrl('Grand Central', 5)).toBe(
      'https://geosearch.planninglabs.nyc/v2/search?text=Grand+Central&size=5',
    );
  });
});
