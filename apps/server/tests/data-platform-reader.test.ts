import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import type { SourceDefinition } from '../src/modules/data-platform/definition.js';
import { healthStore } from '../src/modules/data-platform/health-store.js';
import { NO_FACTS } from '../src/modules/data-platform/health.js';
import { createSourceReader } from '../src/modules/data-platform/reader.js';
import { encodeSnapshot, snapshotStore } from '../src/modules/data-platform/snapshots.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { testSource, type Sample } from './support/sources.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;
let validations = 0;

/** The test source with a schema that counts how often it validates a copy. */
function countingSource(): SourceDefinition<Sample> {
  const schema = z.object({ items: z.array(z.number()), at: z.string() }).superRefine(() => {
    validations += 1;
  });
  return testSource({ dataSchema: schema });
}

/** Stores a copy and serves it, as an admission does. */
async function serve(sourceId: string, data: Sample): Promise<string> {
  const at = clock.now();
  const snapshot = encodeSnapshot(data);
  await db.transaction(async (tx) => {
    await snapshotStore.put(tx, sourceId, snapshot, at, at, 1);
    await healthStore.write(
      tx,
      {
        ...NO_FACTS,
        sourceId,
        servedVersion: snapshot.version,
        dataTime: at,
        receivedAt: at,
        coverage: `${String(data.items.length)} items`,
        etag: undefined,
        lastGoodAt: at,
        lastErrorAt: undefined,
        latencyMs: 1,
        state: 'healthy',
        stateSince: at,
        evidence: 'Served.',
      },
      at,
    );
  });
  return snapshot.version;
}

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T12:00:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
  validations = 0;
});

afterEach(async () => {
  await temp.dispose();
});

describe('source reader', () => {
  it('gives the version served and validates each version once', async () => {
    const source = countingSource();
    const reader = createSourceReader({ db, clock, missingVariables: () => [] });
    const first = await serve(source.id, { items: [1, 2], at: '2026-11-11T11:59:00.000Z' });
    const read = await reader.read(source);
    const again = await reader.read(source);
    expect(read).toMatchObject({ version: first, data: { items: [1, 2] } });
    expect(again.version).toBe(first);
    expect(again.data).toBe(read.data);
    expect(validations).toBe(1);
    const second = await serve(source.id, { items: [3], at: '2026-11-11T12:00:00.000Z' });
    expect(await reader.read(source)).toMatchObject({ version: second, data: { items: [3] } });
    expect(validations).toBe(2);
  });

  it('validates again for another definition of the same id', async () => {
    const reader = createSourceReader({ db, clock, missingVariables: () => [] });
    const source = countingSource();
    await serve(source.id, { items: [1], at: '2026-11-11T11:59:00.000Z' });
    await reader.read(source);
    await reader.read(countingSource());
    expect(validations).toBe(2);
  });

  it('gives no version when nothing is served', async () => {
    const reader = createSourceReader({ db, clock, missingVariables: () => [] });
    const reading = await reader.read(countingSource());
    expect(reading.data).toBeUndefined();
    expect(reading.version).toBeUndefined();
  });
});
