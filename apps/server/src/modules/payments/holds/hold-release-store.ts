import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import { nextHoldCheck } from './hold-context.js';
import type { HoldRecord } from './hold-ledger.js';

/**
 * Money PayPal holds for a purchase that was refused: MovIQ owes the traveller its release. The
 * obligation is written with the refusal and kept apart from the hold, so whatever PayPal says
 * meanwhile, reconciliation voids the authorization (same request id each time) until PayPal
 * confirms it. Only a voided or failed hold discharges it.
 */
export interface OwedRelease {
  readonly holdId: string;
  readonly checks: number;
}

const rowSchema = z
  .object({ hold_id: z.string(), checks: z.number().int().nonnegative() })
  .transform((row): OwedRelease => ({ holdId: row.hold_id, checks: row.checks }));

export const releaseStore = {
  /** Records that the hold must be released; a repeat keeps the first record. */
  async owe(tx: Transaction, hold: HoldRecord, reason: string, now: Date): Promise<void> {
    const at = toInstant(now);
    await tx.execute({
      sql: `INSERT INTO payment_hold_releases (hold_id, reason, status, checks, next_check_at,
              created_at, updated_at) VALUES (?, ?, 'owed', 0, ?, ?, ?)
            ON CONFLICT (hold_id) DO NOTHING`,
      args: [hold.id, reason, toInstant(nextHoldCheck('unknown', 0, now) ?? now), at, at],
    });
  },

  /** The money is released: the obligation, if there is one, is met. */
  async discharge(tx: Transaction, holdId: string, now: Date): Promise<void> {
    await tx.execute({
      sql: `UPDATE payment_hold_releases SET status = 'released', next_check_at = NULL,
              updated_at = ? WHERE hold_id = ? AND status = 'owed'`,
      args: [toInstant(now), holdId],
    });
  },

  async due(db: Database, now: Date, limit: number): Promise<readonly OwedRelease[]> {
    const result = await db.query({
      sql: `SELECT hold_id, checks FROM payment_hold_releases
            WHERE status = 'owed' AND next_check_at <= ? ORDER BY next_check_at LIMIT ?`,
      args: [toInstant(now), limit],
    });
    return result.rows.map((row) => parseRow(rowSchema, row, 'payment_hold_releases'));
  },

  /** The release is still owed after an attempt: the next one, later each time. */
  async reschedule(
    tx: Transaction,
    owed: OwedRelease,
    detail: string | null,
    now: Date,
  ): Promise<void> {
    const checks = owed.checks + 1;
    await tx.execute({
      sql: `UPDATE payment_hold_releases SET checks = ?, next_check_at = ?, detail = ?,
              updated_at = ? WHERE hold_id = ? AND status = 'owed'`,
      args: [
        checks,
        toInstant(nextHoldCheck('unknown', checks, now) ?? now),
        detail,
        toInstant(now),
        owed.holdId,
      ],
    });
  },
};
