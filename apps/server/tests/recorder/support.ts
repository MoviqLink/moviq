import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toInstant } from '@moviq/contracts';

import { systemClock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import { healthStore } from '../../src/modules/data-platform/health-store.js';
import { encodeSnapshot, snapshotStore } from '../../src/modules/data-platform/snapshots.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

export interface RecorderWorld {
  readonly temp: TempDatabase;
  readonly db: Database;
  readonly directory: string;
  readonly term: LeaderTerm;
  dispose(): Promise<void>;
}

/** A migrated database, an empty recording folder and a term that never loses its lease. */
export async function recorderWorld(): Promise<RecorderWorld> {
  const temp = await tempDatabase();
  const db = await temp.open();
  await migrate(db, await readMigrations(MIGRATIONS), systemClock);
  const directory = await mkdtemp(join(tmpdir(), 'moviq-recording-'));
  const controller = new AbortController();
  const term: LeaderTerm = {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: controller.signal,
    fenced: (work) => db.transaction(work),
  };
  return {
    temp,
    db,
    directory,
    term,
    async dispose() {
      controller.abort();
      await temp.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

/** Admits one version of a source as the collector does: its snapshot and its run. */
export async function admit(
  db: Database,
  sourceId: string,
  data: unknown,
  dataTime: string,
  keep = 1,
): Promise<string> {
  const snapshot = encodeSnapshot(data);
  const at = new Date(dataTime);
  await db.transaction(async (tx) => {
    await snapshotStore.put(tx, sourceId, snapshot, at, at, keep);
    await healthStore.addRun(tx, {
      sourceId,
      trigger: 'schedule',
      requestedBy: null,
      reason: null,
      startedAt: toInstant(at),
      finishedAt: toInstant(at),
      outcome: 'admitted',
      httpStatus: 200,
      bytes: 100,
      durationMs: 10,
      dataTime: toInstant(at),
      version: snapshot.version,
      coverage: 'test',
      errorCode: null,
      detail: null,
    });
  });
  return snapshot.version;
}
