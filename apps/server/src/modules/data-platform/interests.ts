import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

type InterestKind = 'journey' | 'virtual-ride' | 'screen';

export interface InterestRequest {
  readonly kind: InterestKind;
  /** What is interested, such as a journey id; together with the source it names the interest. */
  readonly ref: string;
  readonly sourceIds: readonly string[];
  readonly ttlMs: number;
}

const sourceRowSchema = z.object({ source_id: z.string() });

/**
 * Explicit, expiring interest in sources. Registering again extends it; an interest nobody
 * renews simply expires, so a closed screen never keeps a source hot.
 */
export const interestStore = {
  async register(db: Database, request: InterestRequest, now: Date): Promise<void> {
    const expiresAt = toInstant(new Date(now.getTime() + request.ttlMs));
    await db.transaction(async (tx) => {
      for (const sourceId of request.sourceIds) {
        await tx.execute({
          sql: `INSERT INTO interests (id, source_id, kind, ref, expires_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET expires_at = excluded.expires_at`,
          args: [
            `${request.kind}:${request.ref}:${sourceId}`,
            sourceId,
            request.kind,
            request.ref,
            expiresAt,
          ],
        });
      }
    });
  },

  async activeSourceIds(db: Database, now: Date): Promise<ReadonlySet<string>> {
    const result = await db.query({
      sql: 'SELECT DISTINCT source_id FROM interests WHERE expires_at > ?',
      args: [toInstant(now)],
    });
    return new Set(result.rows.map((row) => parseRow(sourceRowSchema, row, 'interests').source_id));
  },

  expiredStatement(now: Date) {
    return { sql: 'DELETE FROM interests WHERE expires_at <= ?', args: [toInstant(now)] };
  },
};
