import { describe, expect, it } from 'vitest';

import type { SourceReader } from '../../../src/modules/data-platform/reader.js';
import { createSubwayRoutes } from '../../../src/modules/live/estimation/recorded-routes.js';
import { createSegmentCache } from '../../../src/modules/live/estimation/recorded-segments.js';
import type { RecordedDistribution } from '../../../src/modules/live/estimation/statistics.js';
import type { SegmentKey } from '../../../src/modules/recorder/reading-estimation.js';
import { manualClock } from '../../support/manual-clock.js';
import { RUN_TIME } from './statistics.js';

const KEY: SegmentKey = {
  mode: 'subway',
  route: 'A',
  from: 'A06N',
  to: 'A05N',
  band: 'evening',
  dayType: 'weekday',
};

/** A read the test answers when it wants, counting how often it is asked. */
function heldRead() {
  const pending: ((value: RecordedDistribution | null) => void)[] = [];
  return {
    pending,
    read: () =>
      new Promise<RecordedDistribution | null>((resolve) => {
        pending.push(resolve);
      }),
  };
}

describe('the segments kept from the recorder', () => {
  it('answers at once and reads in the background, once per segment and renewal', async () => {
    const held = heldRead();
    const cache = createSegmentCache(held.read, () => undefined);
    // The estimator is answered while the database has not answered yet.
    expect(cache.get(KEY)).toBeNull();
    expect(cache.get(KEY)).toBeNull();
    held.pending[0]?.(RUN_TIME);
    await cache.settled();
    expect(cache.get(KEY)).toBe(RUN_TIME);
    expect(held.pending).toHaveLength(1);
    // After a renewal the kept answer is given while it is read again.
    cache.renew();
    expect(cache.get(KEY)).toBe(RUN_TIME);
    expect(held.pending).toHaveLength(2);
    held.pending[1]?.(null);
    await cache.settled();
    expect(cache.get(KEY)).toBeNull();
  });

  it('keeps the last answer when a read fails, and reads nothing once stopped', async () => {
    const errors: unknown[] = [];
    let reads = 0;
    const cache = createSegmentCache(
      () => {
        reads += 1;
        return reads === 1 ? Promise.resolve(RUN_TIME) : Promise.reject(new Error('locked'));
      },
      (error) => errors.push(error),
    );
    cache.get(KEY);
    await cache.settled();
    cache.renew();
    cache.get(KEY);
    await cache.settled();
    expect(cache.get(KEY)).toBe(RUN_TIME);
    expect(errors).toHaveLength(1);
    await cache.stop();
    cache.renew();
    cache.get(KEY);
    await cache.settled();
    expect(reads).toBe(2);
  });
});

/** The eight subway feeds as a reader, each listing trips of the routes given. */
function readerListing(routes: Record<string, readonly string[]>): SourceReader {
  return {
    read: (definition) =>
      Promise.resolve({
        data: definition.dataSchema.parse({
          feedTime: '2026-11-11T01:05:03.000Z',
          leftOut: 0,
          trips: (routes[definition.id] ?? []).map((routeId, index) => ({
            tripId: `T${String(index)}`,
            routeId,
            direction: 'north',
            startDate: '20261110',
            startTime: '20:00:00',
            stops: [
              {
                stopId: 'A05N',
                sequence: null,
                arrival: '2026-11-11T01:08:00.000Z',
                departure: '2026-11-11T01:08:00.000Z',
              },
            ],
            train: null,
          })),
        }),
        provenance: {
          sourceId: definition.id,
          dataTime: '2026-11-11T01:05:03.000Z',
          receivedAt: '2026-11-11T01:05:05.000Z',
          ageSeconds: 2,
          state: 'healthy',
          evidence: 'test',
        },
      }),
  };
}

describe('the feed of each subway route', () => {
  it('looks again for a route no feed listed, at most once a minute', async () => {
    const listed: Record<string, string[]> = { 'mta-subway-ace': ['A'] };
    const clock = manualClock('2026-11-11T01:07:00.000Z');
    const routes = createSubwayRoutes(readerListing(listed), clock, () => undefined);
    await routes.read();
    expect(routes.feedOf('A')).toBe('mta-subway-ace');
    listed['mta-subway-ace'] = ['A', 'C'];
    // Read a moment ago: the C waits for the next minute.
    expect(routes.feedOf('C')).toBeUndefined();
    await routes.settled();
    expect(routes.feedOf('C')).toBeUndefined();
    clock.advance(60_000);
    expect(routes.feedOf('C')).toBeUndefined();
    await routes.settled();
    expect(routes.feedOf('C')).toBe('mta-subway-ace');
    expect(routes.feedOf('lirr:1')).toBeUndefined();
  });
});
