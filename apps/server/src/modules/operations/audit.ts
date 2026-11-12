import type { Transaction } from '@libsql/client';
import type { auditListSchema } from '@moviq/contracts';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

export interface AuditEntry {
  readonly actor: string;
  readonly action: string;
  readonly target: string;
  readonly reason: string | null;
}

const rowSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  reason: z.string().nullable(),
});

/** Every sensitive action, recorded in the same transaction as the action itself. */
export const auditLog = {
  async record(tx: Transaction, entry: AuditEntry, now: Date): Promise<void> {
    await tx.execute({
      sql: 'INSERT INTO audit_log (at, actor, action, target, reason) VALUES (?, ?, ?, ?, ?)',
      args: [toInstant(now), entry.actor, entry.action, entry.target, entry.reason],
    });
  },

  async recent(db: Database, limit: number): Promise<z.infer<typeof auditListSchema>> {
    const result = await db.query({
      sql: 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?',
      args: [limit],
    });
    return { entries: result.rows.map((row) => parseRow(rowSchema, row, 'audit_log')) };
  },
};
