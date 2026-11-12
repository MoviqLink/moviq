import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/** Normalised data ready to store: compressed JSON and a version derived from its content. */
export interface EncodedSnapshot {
  readonly version: string;
  readonly payload: Uint8Array;
}

export function encodeSnapshot(data: unknown): EncodedSnapshot {
  const json = JSON.stringify(data);
  const version = createHash('sha256').update(json).digest('hex').slice(0, 16);
  return { version, payload: gzipSync(json) };
}

function decodeSnapshot(payload: Uint8Array): unknown {
  return JSON.parse(gunzipSync(payload).toString('utf8'));
}

const payloadRowSchema = z.object({ payload: z.instanceof(ArrayBuffer) });

export const snapshotStore = {
  /** Stores a new version and keeps only the newest `keep` versions of the source. */
  async put(
    tx: Transaction,
    sourceId: string,
    snapshot: EncodedSnapshot,
    dataTime: Date,
    admittedAt: Date,
    keep: number,
  ): Promise<void> {
    await tx.execute({
      sql: `INSERT INTO source_snapshots (source_id, version, data_time, admitted_at, bytes, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (source_id, version) DO UPDATE SET admitted_at = excluded.admitted_at`,
      args: [
        sourceId,
        snapshot.version,
        toInstant(dataTime),
        toInstant(admittedAt),
        snapshot.payload.byteLength,
        snapshot.payload,
      ],
    });
    // The version just stored always stays; ties in admission time fall back to insertion order.
    await tx.execute({
      sql: `DELETE FROM source_snapshots WHERE source_id = ? AND version <> ? AND version NOT IN (
              SELECT version FROM source_snapshots WHERE source_id = ? AND version <> ?
              ORDER BY admitted_at DESC, rowid DESC LIMIT ?)`,
      args: [sourceId, snapshot.version, sourceId, snapshot.version, keep - 1],
    });
  },

  async read(db: Database, sourceId: string, version: string): Promise<unknown> {
    const result = await db.query({
      sql: 'SELECT payload FROM source_snapshots WHERE source_id = ? AND version = ?',
      args: [sourceId, version],
    });
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const { payload } = parseRow(payloadRowSchema, row, 'source_snapshots');
    return decodeSnapshot(new Uint8Array(payload));
  },
};
