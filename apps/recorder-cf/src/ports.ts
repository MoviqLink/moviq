import type { HttpClient } from '../../server/src/infrastructure/http/client.js';
import type { RecordedSource } from './sources.js';

/**
 * The parts of the Workers runtime the recorder uses, typed here so its logic runs the same in
 * Node tests (with `node:sqlite` and an in-memory bucket) and in the Durable Object.
 */
export type SqlValue = string | number | null | ArrayBuffer;

export interface Sql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

export interface StoredObject {
  readonly size: number;
  readonly customMetadata?: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface Bucket {
  put(
    key: string,
    value: Blob | string,
    options?: { customMetadata: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
}

/** What the recorder of the Durable Object is given. */
export interface RecorderDeps {
  readonly sql: Sql;
  readonly bucket: Bucket;
  readonly http: HttpClient;
  readonly sources: readonly RecordedSource[];
  readonly now: () => number;
  readonly random: () => number;
}
