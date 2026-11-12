import { describe, expect, it } from 'vitest';

import { mtaSources } from '../../../src/modules/data-platform/sources/mta/index.js';
import { CAPTURED_AT } from './captures.js';

describe('MTA sources in the catalogue', () => {
  it('lists 7 timetables, 8 subway feeds, 2 Bus Time feeds, alerts and elevators once each', () => {
    const ids = mtaSources.map((definition) => definition.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('mta-gtfs-'))).toHaveLength(7);
    expect(ids.filter((id) => id.startsWith('mta-subway-'))).toHaveLength(8);
    expect(ids.filter((id) => id.startsWith('mta-bus-'))).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(['mta-alerts', 'mta-elevators']));
  });

  it.each(mtaSources.map((definition) => [definition.id, definition] as const))(
    '%s is complete and consistent',
    (_id, definition) => {
      expect(definition.licence.attribution).toContain('MTA');
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
      const { url, headers } = definition.request({ credentials: {}, now: CAPTURED_AT });
      expect(url).toMatch(/^https:\/\//);
      expect(headers).toBeUndefined();
      expect(definition.integration).toBeUndefined();
    },
  );
});
