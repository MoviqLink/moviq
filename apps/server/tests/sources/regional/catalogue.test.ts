import { productFeatureSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { sourceCatalog } from '../../../src/modules/data-platform/catalog.js';
import { airSources } from '../../../src/modules/data-platform/sources/air/index.js';
import { bikeSources } from '../../../src/modules/data-platform/sources/bikes/index.js';
import { ferrySources } from '../../../src/modules/data-platform/sources/ferries/index.js';
import { regionalSources } from '../../../src/modules/data-platform/sources/regional/index.js';
import { seaSources } from '../../../src/modules/data-platform/sources/sea/index.js';

const NOW = new Date('2026-11-11T02:30:00Z');
const lists = [regionalSources, ferrySources, bikeSources, airSources, seaSources];
const all = lists.flat();

describe('city transport sources in the catalogue', () => {
  it('lists 6 regional, 8 ferry (NYC Ferry, Staten Island, NY Waterway), 2 bike, 3 air and 1 sea source', () => {
    expect(lists.map((list) => list.length)).toEqual([6, 8, 2, 3, 1]);
  });

  it('gives every source of the whole catalogue its own id', () => {
    const ids = sourceCatalog.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(all.map((definition) => [definition.id, definition] as const))(
    '%s is complete and consistent',
    (_id, definition) => {
      expect(definition.licence.attribution.length).toBeGreaterThan(0);
      expect(definition.licence.url).toMatch(/^https:\/\//);
      const { degradedAfterMs, staleAfterMs, unavailableAfterMs } = definition.freshness;
      expect(degradedAfterMs).toBeLessThan(staleAfterMs);
      expect(staleAfterMs).toBeLessThan(unavailableAfterMs);
      // A source read on its base rhythm is not degraded between two reads.
      expect(definition.rhythm.baseIntervalMs).toBeLessThan(degradedAfterMs);
      expect(definition.rhythm.interestIntervalMs ?? 0).toBeLessThanOrEqual(
        definition.rhythm.baseIntervalMs,
      );
      expect(definition.keepVersions).toBe(definition.kind === 'static' ? 3 : 1);
      const codes = definition.failures.map((failure) => failure.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes).toEqual(expect.arrayContaining(['http-503', 'timeout', 'http-403']));
      expect(definition.consumers).toContain('live-map');
      for (const consumer of definition.consumers) {
        expect(productFeatureSchema.safeParse(consumer).success).toBe(true);
      }
      // No key: the request carries no credential, in the address or the headers.
      expect(definition.integration).toBeUndefined();
      const { url, headers } = definition.request({ credentials: {}, now: NOW });
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/key|token|secret/i);
      expect(Object.keys(headers ?? {})).toEqual(
        Object.keys(headers ?? {}).filter((name) => name === 'accept'),
      );
    },
  );

  it('gives the failures of each provider its own name', () => {
    const httpDetection = (id: string): string =>
      all.find((definition) => definition.id === id)?.failures.find((f) => f.code === 'http-503')
        ?.detection ?? '';
    expect(httpDetection('mta-lirr-realtime')).toContain('MTA');
    expect(httpDetection('path-arrivals')).toContain('panynj.gov');
    expect(httpDetection('nyc-ferry-positions')).toContain('connexionz');
    expect(httpDetection('staten-island-ferry-gtfs')).toContain('nyc.gov');
    expect(httpDetection('citi-bike-station-status')).toContain('gbfs.lyft.com');
    expect(httpDetection('adsb-lol-new-york')).toContain('adsb.lol');
    expect(httpDetection('adsb-fi-new-york')).toContain('adsb.fi');
    expect(httpDetection('open-waters-new-york-harbor')).toContain('openwaters');
  });
});
