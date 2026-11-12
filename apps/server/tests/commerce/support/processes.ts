import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface ServerProcess {
  readonly output: () => string;
  /** Sends the signal and waits for the process to end, with its exit code. */
  stop(signal: 'SIGTERM' | 'SIGKILL'): Promise<number | null>;
}

const running = new Set<ChildProcess>();

/** Runs an entry point from source, as `npm run dev` does, with only the given variables. */
export function startProcess(
  entry: 'main' | 'worker',
  env: Readonly<Record<string, string>>,
): ServerProcess {
  const child = spawn(
    process.execPath,
    ['--conditions=moviq-source', '--import', 'tsx', `src/${entry}.ts`],
    { cwd: SERVER_ROOT, env: { PATH: process.env['PATH'] ?? '', ...env } },
  );
  running.add(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => {
      running.delete(child);
      resolve(code);
    }),
  );
  return {
    output: () => output,
    stop: (signal) => {
      child.kill(signal);
      return exited;
    },
  };
}

/** Kills whatever a test left running. */
export function killAll(): void {
  for (const child of running) child.kill('SIGKILL');
}

export function freePort(): Promise<number> {
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

export async function waitFor(
  what: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what}: not met within ${String(timeoutMs)} ms`);
}

/** A browser on a real port: it keeps the cookies it is given, across restarts of the server. */
export function portBrowser(origin: string) {
  const cookies = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(cookie === '' ? {} : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const set of response.headers.getSetCookie()) {
      const [pair = ''] = set.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (value === '') cookies.delete(name);
      else cookies.set(name, value);
    }
    const json: unknown = await response.json();
    return { status: response.status, body: json };
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body),
    put: (path: string, body?: unknown) => call('PUT', path, body),
  };
}
