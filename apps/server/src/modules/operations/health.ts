import { toInstant, type Liveness, type Readiness } from '@moviq/contracts';
import { Hono } from 'hono';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { inspectMigrations, type Migration } from '../../infrastructure/database/migrations.js';
import type { AppBindings } from '../../infrastructure/http/context.js';

export interface HealthDependencies {
  readonly db: Database;
  readonly migrations: readonly Migration[];
  readonly clock: Clock;
  readonly version: string;
  /** How long the database may take to answer before the process counts as not ready. */
  readonly databaseTimeoutMs?: number;
}

const DEFAULT_DATABASE_TIMEOUT_MS = 2_000;

/**
 * `/healthz` says the process is alive. `/readyz` proves it can work: it reads the database and
 * compares its migrations with the code, because a process that answers is not proof of a
 * healthy database.
 */
export function healthRoutes(deps: HealthDependencies): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  routes.get('/healthz', (c) => c.json<Liveness>({ status: 'ok' }));
  routes.get('/readyz', async (c) => {
    const readiness = await checkReadiness(deps);
    return c.json(readiness, readiness.status === 'ready' ? 200 : 503);
  });
  return routes;
}

async function checkReadiness(deps: HealthDependencies): Promise<Readiness> {
  const timeoutMs = deps.databaseTimeoutMs ?? DEFAULT_DATABASE_TIMEOUT_MS;
  const started = performance.now();
  let database: Readiness['checks']['database'];
  let migrations: Readiness['checks']['migrations'];
  try {
    const status = await withTimeout(inspectMigrations(deps.db, deps.migrations), timeoutMs);
    database = { ok: true, latencyMs: elapsed(started), detail: 'The database answered.' };
    migrations = {
      ok: status.pending === 0 && status.problems.length === 0,
      applied: status.applied,
      pending: status.pending,
      detail: describeMigrations(status.pending, status.problems),
    };
  } catch (error) {
    const detail =
      error instanceof TimeoutError
        ? `The database did not answer within ${String(timeoutMs)} ms.`
        : 'The database could not be read.';
    database = { ok: false, latencyMs: elapsed(started), detail };
    migrations = {
      ok: false,
      applied: 0,
      pending: 0,
      detail: 'Not checked: the database is unavailable.',
    };
  }
  return {
    status: database.ok && migrations.ok ? 'ready' : 'not_ready',
    version: deps.version,
    checkedAt: toInstant(deps.clock.now()),
    checks: { database, migrations },
  };
}

function describeMigrations(pending: number, problems: readonly string[]): string {
  if (problems.length > 0) return problems.join(' ');
  if (pending > 0) return `${String(pending)} migration(s) not applied yet.`;
  return 'All migrations are applied.';
}

class TimeoutError extends Error {}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
