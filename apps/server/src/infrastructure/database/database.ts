import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createClient,
  LibsqlError,
  type Client,
  type InStatement,
  type ResultSet,
  type Transaction,
} from '@libsql/client';

export interface DatabaseOptions {
  /** `file:<path>` for a local SQLite file, or `libsql://…` for a remote libSQL server. */
  readonly url: string;
  readonly authToken: string | undefined;
  /** Relative `file:` paths resolve against this folder, never against the working directory. */
  readonly baseDirectory: string;
  /** How long a write keeps retrying while another process holds the write lock. */
  readonly busyDeadlineMs?: number;
}

/**
 * The single gateway to SQL. Reads run directly; writes and transactions are serialised inside
 * the process and retried without blocking the event loop while another process holds the lock.
 */
export interface Database {
  query(statement: InStatement): Promise<ResultSet>;
  execute(statement: InStatement): Promise<ResultSet>;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): void;
}

export class DatabaseBusyError extends Error {
  constructor(waitedMs: number) {
    super(`The database stayed locked by another process for ${String(waitedMs)} ms.`);
    this.name = 'DatabaseBusyError';
  }
}

const DEFAULT_BUSY_DEADLINE_MS = 5_000;

export async function openDatabase(options: DatabaseOptions): Promise<Database> {
  const location = locateDatabase(options.url, options.baseDirectory);
  const localPath = location.kind === 'file' ? location.path : undefined;
  if (localPath !== undefined) {
    await mkdir(dirname(localPath), { recursive: true });
  }
  const connect = (): Client =>
    createClient(
      options.authToken === undefined
        ? { url: location.url }
        : { url: location.url, authToken: options.authToken },
    );
  const client = connect();
  if (localPath !== undefined) {
    await client.execute('PRAGMA journal_mode = WAL');
  }
  return wrapClient(client, {
    // A local connection that got SQLITE_BUSY keeps the failed statement active, and SQLite then
    // refuses to commit on it ("SQL statements in progress"). It is replaced before retrying.
    reconnect: localPath === undefined ? undefined : connect,
    busyDeadlineMs: options.busyDeadlineMs ?? DEFAULT_BUSY_DEADLINE_MS,
  });
}

interface WrapOptions {
  readonly reconnect: (() => Client) | undefined;
  readonly busyDeadlineMs: number;
}

function wrapClient(initial: Client, options: WrapOptions): Database {
  let client = initial;
  const exclusive = createMutex();
  const onBusy = () => {
    if (options.reconnect === undefined) return;
    client.close();
    client = options.reconnect();
  };
  const retry = <T>(work: () => Promise<T>): Promise<T> =>
    retryWhileBusy(work, options.busyDeadlineMs, onBusy);
  const withRetry = <T>(work: () => Promise<T>): Promise<T> => exclusive(() => retry(work));

  return {
    query: (statement) => client.execute(statement),
    execute: (statement) => withRetry(() => client.execute(statement)),
    transaction: (work) =>
      exclusive(async () => {
        const tx = await retry(() => client.transaction('write'));
        try {
          const result = await work(tx);
          await tx.commit();
          return result;
        } finally {
          tx.close();
        }
      }),
    close: () => {
      client.close();
    },
  };
}

export type DatabaseLocation =
  | { readonly kind: 'file'; readonly path: string; readonly url: string }
  | { readonly kind: 'remote'; readonly url: string };

/**
 * Turns a database URL into the absolute file it names, or keeps a remote URL as it is. Both
 * `file:relative/path` and `file:///absolute%20path` are understood, and the file URL handed to
 * the client is rebuilt from the decoded path, so the folder created and the file opened match.
 */
export function locateDatabase(url: string, baseDirectory: string): DatabaseLocation {
  if (!url.startsWith('file:')) return { kind: 'remote', url };
  const withoutQuery = url.split('?')[0] ?? url;
  const named = withoutQuery.startsWith('file://')
    ? fileURLToPath(withoutQuery)
    : decodeURIComponent(withoutQuery.slice('file:'.length));
  if (named === '' || named.includes(':memory:')) {
    throw new RangeError('An in-memory database loses its data on every new connection.');
  }
  const path = isAbsolute(named) ? named : resolve(baseDirectory, named);
  return { kind: 'file', path, url: pathToFileURL(path).href };
}

function createMutex(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

async function retryWhileBusy<T>(
  work: () => Promise<T>,
  deadlineMs: number,
  onBusy: () => void,
): Promise<T> {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const waited = Date.now() - started;
      if (!isBusy(error)) throw error;
      onBusy();
      if (waited >= deadlineMs) throw new DatabaseBusyError(waited);
      await delay(backoffMs(attempt));
    }
  }
}

function isBusy(error: unknown): boolean {
  return error instanceof LibsqlError && error.code === 'SQLITE_BUSY';
}

function backoffMs(attempt: number): number {
  const ceiling = Math.min(200, 10 * 2 ** attempt);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}
