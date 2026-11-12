import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readinessSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EXIT_CONFIG } from '../src/bootstrap.js';
import { openDatabase, type Database } from '../src/infrastructure/database/database.js';
import { parseRow } from '../src/infrastructure/database/rows.js';

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

let folder: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'moviq-process-'));
});

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await rm(folder, { recursive: true, force: true });
});

interface Started {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exited: Promise<number | null>;
}

/** Runs an entry point from source, the way `npm run dev` does, with only the given variables. */
function start(entry: 'main' | 'worker', env: Record<string, string>): Started {
  const child = spawn(
    process.execPath,
    ['--conditions=moviq-source', '--import', 'tsx', `src/${entry}.ts`],
    { cwd: SERVER_ROOT, env: { PATH: process.env['PATH'] ?? '', ...env } },
  );
  children.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { child, output: () => output, exited };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition not met in time');
}

async function portAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${String(port)}/healthz`);
    return true;
  } catch {
    return false;
  }
}

describe('api process', () => {
  it('ends with a configuration error and never opens its port', async () => {
    const port = await freePort();
    const api = start('main', { PORT: String(port), PAYPAL_ENV: 'live', PUBLIC_DEMO: 'true' });
    expect(await api.exited).toBe(EXIT_CONFIG);
    expect(api.output()).toContain('Configuration error, api not started');
    expect(api.output()).toContain('PAYPAL_ENV=live cannot run with PUBLIC_DEMO');
    expect(await portAnswers(port)).toBe(false);
  });

  it('starts without any credential, becomes ready and stops cleanly on SIGTERM', async () => {
    const port = await freePort();
    const api = start('main', {
      PORT: String(port),
      DATABASE_URL: `file:${join(folder, 'api.db')}`,
      APP_ENV: 'test',
    });
    await waitFor(() => portAnswers(port));
    const response = await fetch(`http://127.0.0.1:${String(port)}/readyz`);
    expect(response.status).toBe(200);
    expect(readinessSchema.parse(await response.json()).status).toBe('ready');
    api.child.kill('SIGTERM');
    expect(await api.exited).toBe(0);
    expect(api.output()).toContain('"msg":"stopped"');
    expect(api.output()).toContain('"unavailable"');
  });
});

describe('signals during start-up', () => {
  it('stops cleanly, without opening its port, when stopped while waiting for the database (regression)', async () => {
    const url = `file:${join(folder, 'locked.db')}`;
    const holder = await openDatabase({ url, authToken: undefined, baseDirectory: folder });
    let unblock: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = holder.transaction(async () => {
      entered();
      await new Promise<void>((resolve) => {
        unblock = resolve;
      });
    });
    await inside;
    try {
      const port = await freePort();
      const api = start('main', { PORT: String(port), DATABASE_URL: url, APP_ENV: 'test' });
      await waitFor(() => api.output().includes('"msg":"starting"'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      api.child.kill('SIGTERM');
      expect(await api.exited).toBe(0);
      expect(api.output()).toContain('"msg":"stopped during start-up"');
      expect(await portAnswers(port)).toBe(false);
    } finally {
      unblock();
      await held;
      holder.close();
    }
  }, 20_000);
});

describe('worker process', () => {
  it('takes the worker lease and releases it on SIGTERM', async () => {
    const worker = start('worker', {
      DATABASE_URL: `file:${join(folder, 'worker.db')}`,
      APP_ENV: 'test',
    });
    await waitFor(() => worker.output().includes('"msg":"lease acquired"'));
    worker.child.kill('SIGTERM');
    expect(await worker.exited).toBe(0);
    expect(worker.output()).toContain('"msg":"lease released"');
  });

  it('runs a single leader among two workers, and the other takes over when it dies', async () => {
    const url = `file:${join(folder, 'pair.db')}`;
    const env = {
      DATABASE_URL: url,
      APP_ENV: 'test',
      WORKER_LEASE_TTL_SECONDS: '3',
      WORKER_HEARTBEAT_SECONDS: '1',
    };
    const first = start('worker', env);
    await waitFor(() => first.output().includes('"msg":"lease acquired"'));
    const second = start('worker', env);
    await waitFor(() => second.output().includes('"msg":"schema ready"'));
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(second.output()).not.toContain('"msg":"lease acquired"');

    first.child.kill('SIGKILL');
    await first.exited;
    await waitFor(() => second.output().includes('"msg":"lease acquired"'), 10_000);
    const db = await openDatabase({ url, authToken: undefined, baseDirectory: folder });
    try {
      await waitFor(async () => (await heartbeats(db)).some((beat) => beat.token === 2), 5_000);
      second.child.kill('SIGTERM');
      expect(await second.exited).toBe(0);
      expect(second.output()).toContain('"msg":"lease released"');
      const beats = await heartbeats(db);
      expect(new Set(beats.map((beat) => beat.token))).toEqual(new Set([1, 2]));
      const holders = new Map<number, Set<string>>();
      beats.forEach((beat, index) => {
        if (index > 0) expect(beat.token).toBeGreaterThanOrEqual(beats[index - 1]?.token ?? 0);
        holders.set(beat.token, (holders.get(beat.token) ?? new Set()).add(beat.holder));
      });
      expect([...holders.values()].every((set) => set.size === 1)).toBe(true);
    } finally {
      db.close();
    }
  }, 30_000);
});

async function heartbeats(db: Database): Promise<readonly { token: number; holder: string }[]> {
  const result = await db.query('SELECT fencing_token, holder FROM worker_heartbeats ORDER BY id');
  const schema = z.object({ fencing_token: z.number(), holder: z.string() });
  return result.rows
    .map((row) => parseRow(schema, row, 'worker_heartbeats'))
    .map((row) => ({ token: row.fencing_token, holder: row.holder }));
}
