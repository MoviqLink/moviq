import { productFeatureSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { harborSources } from '../../../src/modules/data-platform/sources/harbor/index.js';

const NOW = new Date('2026-11-11T04:00:00Z');

describe('New York Harbor sources', () => {
  it('lists the Coast Guard notices, the PNCT schedule and four NOAA PORTS measures', () => {
    expect(harborSources.map((definition) => definition.id)).toEqual([
      'uscg-sector-new-york-notices',
      'pnct-vessel-schedule',
      'noaa-ports-battery-water-level',
      'noaa-ports-verrazzano-air-gap',
      'noaa-ports-kill-van-kull-current',
      'noaa-ports-robbins-reef-wind',
    ]);
  });

  it.each(harborSources.map((definition) => [definition.id, definition] as const))(
    '%s is complete and consistent',
    (_id, definition) => {
      expect(definition.licence.attribution.length).toBeGreaterThan(0);
      expect(definition.licence.url).toMatch(/^https:\/\//);
      const { degradedAfterMs, staleAfterMs, unavailableAfterMs } = definition.freshness;
      expect(degradedAfterMs).toBeLessThan(staleAfterMs);
      expect(staleAfterMs).toBeLessThan(unavailableAfterMs);
      expect(definition.rhythm.baseIntervalMs).toBeLessThan(degradedAfterMs);
      expect(definition.kind).toBe('realtime');
      expect(definition.keepVersions).toBe(1);
      const codes = definition.failures.map((failure) => failure.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect(codes).toEqual(expect.arrayContaining(['http-503', 'timeout', 'http-403']));
      expect(definition.consumers).toContain('live-map');
      for (const consumer of definition.consumers) {
        expect(productFeatureSchema.safeParse(consumer).success).toBe(true);
      }
      // No key and no header but `accept`: the generic identity of the HTTP client goes alone.
      expect(definition.integration).toBeUndefined();
      const { url, headers } = definition.request({ credentials: {}, now: NOW });
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/key|token|secret/i);
      expect(Object.keys(headers ?? {})).toEqual(['accept']);
    },
  );

  it('dates by receipt only the sources whose provider gives no time', () => {
    const byReceipt = harborSources.filter((definition) => definition.dataTimeSource === 'receipt');
    expect(byReceipt.map((definition) => definition.id)).toEqual([
      'uscg-sector-new-york-notices',
      'pnct-vessel-schedule',
    ]);
  });
});
