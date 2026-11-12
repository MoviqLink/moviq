import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import type { Bucket, Sql, SqlValue, StoredObject } from '../src/ports.js';

/** The Durable Object's SQL on `node:sqlite`: BLOBs go in and come out as `ArrayBuffer`. */
export function memorySql(): Sql & { readonly writes: () => number } {
  const db = new DatabaseSync(':memory:');
  let writes = 0;
  const input = (value: SqlValue): SQLInputValue =>
    value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  const output = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Uint8Array ? value.slice().buffer : value,
      ]),
    );
  return {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      const values = bindings.map(input);
      if (/^\s*SELECT/i.test(query)) {
        const rows = statement.all(...values).map((row) => output({ ...row }));
        return { toArray: () => rows };
      }
      writes += Number(statement.run(...values).changes);
      return { toArray: () => [] };
    },
    writes: () => writes,
  };
}

const stored = (bytes: Uint8Array, customMetadata?: Record<string, string>): StoredObject => ({
  size: bytes.byteLength,
  ...(customMetadata === undefined ? {} : { customMetadata }),
  arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  text: () => Promise.resolve(new TextDecoder().decode(bytes)),
});

/** An R2 bucket in memory, with custom metadata and listing by prefix. */
export function memoryBucket(): Bucket & {
  readonly objects: Map<string, Uint8Array>;
  readonly metadata: Map<string, Record<string, string>>;
} {
  const objects = new Map<string, Uint8Array>();
  const metadata = new Map<string, Record<string, string>>();
  return {
    objects,
    metadata,
    async put(key, value, options) {
      const bytes =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : new Uint8Array(await value.arrayBuffer());
      objects.set(key, bytes);
      if (options === undefined) metadata.delete(key);
      else metadata.set(key, options.customMetadata);
    },
    get(key) {
      const bytes = objects.get(key);
      return Promise.resolve(bytes === undefined ? null : stored(bytes, metadata.get(key)));
    },
    list({ prefix }) {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      return Promise.resolve({
        objects: keys.map((key) => ({ key, size: objects.get(key)?.byteLength ?? 0 })),
        truncated: false,
      });
    },
    delete(keys) {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
  };
}

const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));

/** A real capture from `tests/fixtures/` at the root of the repository. */
export const fixture = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(`${FIXTURES}${path}`));
