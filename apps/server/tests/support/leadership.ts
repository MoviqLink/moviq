import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { systemClock, type Clock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { parseRow } from '../../src/infrastructure/database/rows.js';
import {
  runAsLeader,
  type LeaderTerm,
  type LeaderWork,
} from '../../src/infrastructure/jobs/leadership.js';
import { createLeaseStore, type LeaseStore } from '../../src/infrastructure/jobs/lease.js';
import { memoryLogger, type MemoryLogger } from './memory-logger.js';
import { tempDatabase, type TempDatabase } from './temp-database.js';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** A migrated database with a `work_log` table where leader work records its writes. */
export async function leadershipDatabase(): Promise<{ temp: TempDatabase; db: Database }> {
  const temp = await tempDatabase();
  const db = await temp.open();
  await migrate(db, await readMigrations(MIGRATIONS), systemClock);
  await db.execute('CREATE TABLE work_log (id INTEGER PRIMARY KEY, holder TEXT, token INTEGER)');
  return { temp, db };
}

export interface Runner {
  readonly log: MemoryLogger;
  readonly stop: () => Promise<void>;
}

export interface RunnerOptions {
  readonly holder: string;
  readonly work: LeaderWork;
  readonly clock?: Clock;
  readonly store?: LeaseStore;
  readonly ttlMs?: number;
  readonly intervalMs?: number;
}

/** Starts `runAsLeader` on `target` for the lease named `worker`. */
export function startRunner(target: Database, options: RunnerOptions): Runner {
  const clock = options.clock ?? systemClock;
  const log = memoryLogger();
  const controller = new AbortController();
  const running = runAsLeader({
    db: target,
    clock,
    store: options.store ?? createLeaseStore(target, clock),
    name: 'worker',
    holder: options.holder,
    ttlMs: options.ttlMs ?? 1_000,
    intervalMs: options.intervalMs ?? 20,
    logger: log.logger,
    signal: controller.signal,
    work: options.work,
  });
  return {
    log,
    stop: async () => {
      controller.abort();
      await running;
    },
  };
}

export const messages = (log: MemoryLogger): unknown[] =>
  log.entries().map((entry) => entry['msg']);

/** Work that signals its start and then runs until its term ends. */
export function untilTermEnds(onStart: (term: LeaderTerm) => void = () => undefined): LeaderWork {
  return async (term) => {
    onStart(term);
    await new Promise<void>((resolve) => {
      term.signal.addEventListener('abort', () => {
        resolve();
      });
    });
  };
}

export function logWrite(term: LeaderTerm): Promise<unknown> {
  return term.fenced((tx) =>
    tx.execute({
      sql: 'INSERT INTO work_log (holder, token) VALUES (?, ?)',
      args: [term.holder, term.fencingToken],
    }),
  );
}

export async function workLog(db: Database): Promise<readonly { holder: string; token: number }[]> {
  const result = await db.query('SELECT holder, token FROM work_log ORDER BY id');
  const schema = z.object({ holder: z.string(), token: z.number() });
  return result.rows.map((row) => parseRow(schema, row, 'work_log'));
}
