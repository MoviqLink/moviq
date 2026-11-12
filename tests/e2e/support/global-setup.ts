import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MERCHANT_TEST_TOKEN } from '../../../apps/server/tests/support/merchant-access.js';

import { captureRoutes } from './captures.js';
import { E2E_ADMIN_TOKEN, E2E_VIEWER_TOKEN } from './tokens.js';
import { startProviderServer } from './provider-server.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** What a deployment is started with, beyond the captures that answer its providers. */
interface DeploymentOptions {
  /** More environment for the API and the worker, such as the PayPal sandbox keys. */
  readonly env?: Readonly<Record<string, string>>;
  /** Provider hosts the stand-in sends on to the real service instead of answering them. */
  readonly relayHosts?: readonly string[];
}

/**
 * Starts what a real deployment runs: the API (serving the built web) and the worker, on a fresh
 * database, with every provider answered by captures of real responses. Returns the teardown.
 */
export default function globalSetup(): Promise<() => Promise<void>> {
  return startDeployment();
}

/** The deployment, with `options` on top of what every end-to-end run has. */
export async function startDeployment(
  options: DeploymentOptions = {},
): Promise<() => Promise<void>> {
  if (!existsSync(join(ROOT, 'apps/web/dist/index.html'))) {
    throw new Error('The web build is missing: run `npm run build` before the end-to-end tests.');
  }
  const provider = await startProviderServer(
    join(ROOT, 'tests/fixtures'),
    captureRoutes,
    options.relayHosts,
  );
  const folder = await mkdtemp(join(tmpdir(), 'moviq-e2e-'));
  const database = join(folder, 'e2e.db');
  const port = await freePort();
  // Only these variables: no key of `.env` reaches the deployment, so Sara's model
  // (OPENAI_API_KEY) and every paid provider stay off and every sentence is the watch's own.
  const env = {
    ...options.env,
    PATH: process.env['PATH'] ?? '',
    APP_ENV: 'test',
    MERCHANT_ACCESS_TOKEN: MERCHANT_TEST_TOKEN,
    PORT: String(port),
    LOG_LEVEL: 'warn',
    DATABASE_URL: `file:${database}`,
    ADMIN_TOKEN: E2E_ADMIN_TOKEN,
    OPS_VIEWER_TOKEN: E2E_VIEWER_TOKEN,
    TEST_PROVIDER_ORIGIN: provider.origin,
    WORKER_LEASE_TTL_SECONDS: '3',
    WORKER_HEARTBEAT_SECONDS: '1',
  };
  const api = start('main', env);
  const worker = start('worker', env);
  const teardown = async () => {
    await Promise.all([stop(api), stop(worker)]);
    await provider.close();
    await rm(folder, { recursive: true, force: true });
  };
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  try {
    await waitUntilReady(`${baseUrl}/readyz`, [api, worker]);
  } catch (error) {
    // Whatever started is stopped, so a failed start leaves no process behind.
    await teardown();
    throw error;
  }
  process.env['E2E_BASE_URL'] = baseUrl;
  process.env['E2E_PROVIDER_ORIGIN'] = provider.origin;
  process.env['E2E_DATABASE_FILE'] = database;
  return teardown;
}

function start(entry: 'main' | 'worker', env: Record<string, string>): ChildProcess {
  const child = spawn(
    process.execPath,
    ['--conditions=moviq-source', '--import', 'tsx', `apps/server/src/${entry}.ts`],
    {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  return child;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function waitUntilReady(url: string, children: readonly ChildProcess[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null))
      throw new Error('A process exited during start-up.');
    const ready = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${url} was not ready within 30 s.`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port);
        else reject(new Error('no free port'));
      });
    });
  });
}
