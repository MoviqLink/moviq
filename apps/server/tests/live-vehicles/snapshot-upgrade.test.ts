import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import type { Collect } from '../../src/modules/data-platform/collector.js';
import { NO_FACTS } from '../../src/modules/data-platform/health.js';
import { healthStore, type HealthRecord } from '../../src/modules/data-platform/health-store.js';
import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import { passioRouteSource } from '../../src/modules/data-platform/sources/shuttles/passio-routes.js';
import { upgradeRailTimetables } from '../../src/modules/live/rail-upgrade.js';
import { manualClock } from '../support/manual-clock.js';

const db = {} as Database;
const term: LeaderTerm = {
  name: 'worker',
  holder: 'test',
  fencingToken: 1,
  signal: new AbortController().signal,
  fenced: () => Promise.reject(new Error('not used')),
};
const clock = manualClock();
const collect = vi
  .fn<Collect>()
  .mockResolvedValue({ outcome: 'admitted', errorCode: null, state: 'healthy', evidence: 'ok' });

function readerOf(data: unknown): SourceReader {
  return {
    read(definition) {
      const parsed = definition.dataSchema.safeParse(
        definition.id === passioRouteSource.id ? data : undefined,
      );
      return Promise.resolve({
        data: parsed.success ? parsed.data : undefined,
        provenance: {
          sourceId: definition.id,
          dataTime: null,
          receivedAt: null,
          ageSeconds: null,
          state: 'healthy',
          evidence: 'test',
        },
      });
    },
  };
}

function rateLimited(): HealthRecord {
  return {
    ...NO_FACTS,
    sourceId: passioRouteSource.id,
    receivedAt: undefined,
    coverage: undefined,
    etag: undefined,
    lastGoodAt: undefined,
    lastErrorAt: undefined,
    latencyMs: undefined,
    state: 'rate_limited',
    stateSince: clock.now(),
    evidence: 'test',
    lastOutcome: 'rate_limited',
    lastAttemptAt: clock.now(),
    retryNotBefore: new Date(clock.now().getTime() + 120_000),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  collect.mockClear();
});

describe('stored snapshot upgrades', () => {
  it('refreshes an old Passio representation, once, with a full fetch', async () => {
    vi.spyOn(healthStore, 'read').mockResolvedValue(undefined);
    await upgradeRailTimetables(term, {
      db,
      clock,
      reader: readerOf({ '42': 'encoded' }),
      collect,
    });
    expect(collect).toHaveBeenCalledOnce();
    expect(collect).toHaveBeenCalledWith(
      passioRouteSource,
      term,
      expect.objectContaining({ forceFull: true }),
    );
  });
  it('leaves current and missing data to the normal scheduler', async () => {
    vi.spyOn(healthStore, 'read').mockResolvedValue(undefined);
    await upgradeRailTimetables(term, {
      db,
      clock,
      reader: readerOf({ '42': { name: 'Line', shape: 'encoded' } }),
      collect,
    });
    await upgradeRailTimetables(term, { db, clock, reader: readerOf(undefined), collect });
    expect(collect).not.toHaveBeenCalled();
  });
  it('honours Retry-After even when no consecutive failure is recorded', async () => {
    vi.spyOn(healthStore, 'read').mockResolvedValue(rateLimited());
    await upgradeRailTimetables(term, {
      db,
      clock,
      reader: readerOf({ '42': 'encoded' }),
      collect,
    });
    expect(collect).not.toHaveBeenCalled();
  });
  it('honours exponential backoff after a failure', async () => {
    vi.spyOn(healthStore, 'read').mockResolvedValue({
      ...rateLimited(),
      lastOutcome: 'failed',
      consecutiveFailures: 2,
      retryNotBefore: undefined,
    });
    await upgradeRailTimetables(term, {
      db,
      clock,
      reader: readerOf({ '42': 'encoded' }),
      collect,
    });
    expect(collect).not.toHaveBeenCalled();
  });
});
