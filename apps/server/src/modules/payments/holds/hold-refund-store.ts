import type { Transaction } from '@libsql/client';
import { instantSchema, toInstant, type Money } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import type { PayPalRefund } from '../paypal/schemas.js';
import { nextHoldCheck } from './hold-context.js';

/** `unknown`: PayPal has not confirmed it (no answer, or still reviewing); followed until it does. */
export type RefundState = 'unknown' | 'completed' | 'failed';

export interface HoldRefundRecord {
  readonly holdId: string;
  readonly operation: string;
  readonly amount: Money;
  readonly status: RefundState;
  readonly paypalRefundId: string | null;
  readonly checks: number;
  /** When PayPal was first asked, under the request id every retry repeats. */
  readonly askedAt: Date;
}

const rowSchema = z
  .object({
    hold_id: z.string(),
    operation: z.string(),
    amount_minor: z.number().int().positive(),
    currency: z.literal('USD'),
    status: z.enum(['unknown', 'completed', 'failed']),
    paypal_refund_id: z.string().nullable(),
    checks: z.number().int().nonnegative(),
    created_at: instantSchema,
  })
  .transform((row): HoldRefundRecord => ({
    holdId: row.hold_id,
    operation: row.operation,
    amount: { amountMinor: row.amount_minor, currency: row.currency },
    status: row.status,
    paypalRefundId: row.paypal_refund_id,
    checks: row.checks,
    askedAt: new Date(row.created_at),
  }));

const totalsSchema = z.object({
  completed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

/** What PayPal's status of a refund means for MovIQ's record of it. */
export function refundState(refund: PayPalRefund): RefundState {
  if (refund.status === 'COMPLETED') return 'completed';
  return refund.status === 'PENDING' ? 'unknown' : 'failed';
}

/** `payment_hold_refunds`: each partial refund of a captured hold, under its operation. */
export const refundStore = {
  /** Money given back from a hold, and money whose refund PayPal has not confirmed yet. */
  async totals(db: Database, holdId: string): Promise<{ completed: number; pending: number }> {
    const result = await db.query({
      sql: `SELECT
              COALESCE(SUM(CASE WHEN status = 'completed' THEN amount_minor END), 0) AS completed,
              COALESCE(SUM(CASE WHEN status = 'unknown' THEN amount_minor END), 0) AS pending
            FROM payment_hold_refunds WHERE hold_id = ?`,
      args: [holdId],
    });
    return parseRow(totalsSchema, result.rows[0], 'payment_hold_refunds');
  },

  /** Refunds PayPal has not confirmed whose next look is due, oldest first. */
  async due(db: Database, now: Date, limit: number): Promise<readonly HoldRefundRecord[]> {
    const result = await db.query({
      sql: `SELECT * FROM payment_hold_refunds WHERE status = 'unknown' AND next_check_at <= ?
            ORDER BY next_check_at LIMIT ?`,
      args: [toInstant(now), limit],
    });
    return result.rows.map((row) => parseRow(rowSchema, row, 'payment_hold_refunds'));
  },

  /** Records what PayPal said; a refund still unconfirmed is looked at again, later each time. */
  async settle(
    tx: Transaction,
    refund: Pick<HoldRefundRecord, 'holdId' | 'operation' | 'checks'>,
    result: {
      readonly status: RefundState;
      readonly paypalRefundId: string | null;
      readonly detail: string | null;
    },
    now: Date,
  ): Promise<void> {
    const next = result.status === 'unknown' ? nextHoldCheck('unknown', refund.checks, now) : null;
    await tx.execute({
      sql: `UPDATE payment_hold_refunds SET status = ?,
              paypal_refund_id = COALESCE(?, paypal_refund_id), detail = ?, checks = ?,
              next_check_at = ?, updated_at = ?
            WHERE hold_id = ? AND operation = ? AND status <> 'completed'`,
      args: [
        result.status,
        result.paypalRefundId,
        result.detail,
        refund.checks,
        next === null ? null : toInstant(next),
        toInstant(now),
        refund.holdId,
        refund.operation,
      ],
    });
  },
};
