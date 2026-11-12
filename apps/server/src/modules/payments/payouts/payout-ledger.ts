import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import { toInstant, type Money } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';

export type PayoutStatus =
  'unknown' | 'pending' | 'processing' | 'success' | 'denied' | 'canceled' | 'failed';

/** A batch that will not pay: its sales can be paid again in another one. */
const DEAD_PAYOUTS: ReadonlySet<PayoutStatus> = new Set(['denied', 'canceled', 'failed']);

export interface PayoutBatchRecord {
  readonly id: string;
  readonly merchantId: string;
  readonly receiver: string;
  readonly until: string;
  readonly gross: Money;
  readonly fee: Money;
  readonly net: Money;
  /** Refunds deducted from the batch: `gross` is its sales less these. */
  readonly refunds: Money;
  readonly status: PayoutStatus;
  readonly paypalBatchId: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

const rowSchema = z
  .object({
    id: z.string(),
    merchant_id: z.string(),
    receiver: z.string(),
    until: z.string(),
    gross_minor: z.number().int(),
    fee_minor: z.number().int(),
    net_minor: z.number().int(),
    refunds_minor: z.number().int().nonnegative(),
    currency: z.literal('USD'),
    status: z.enum(['unknown', 'pending', 'processing', 'success', 'denied', 'canceled', 'failed']),
    paypal_batch_id: z.string().nullable(),
    detail: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    version: z.number().int(),
  })
  .transform((row): PayoutBatchRecord => ({
    id: row.id,
    merchantId: row.merchant_id,
    receiver: row.receiver,
    until: row.until,
    gross: { amountMinor: row.gross_minor, currency: row.currency },
    fee: { amountMinor: row.fee_minor, currency: row.currency },
    net: { amountMinor: row.net_minor, currency: row.currency },
    refunds: { amountMinor: row.refunds_minor, currency: row.currency },
    status: row.status,
    paypalBatchId: row.paypal_batch_id,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }));

const toRecord = (row: unknown) => parseRow(rowSchema, row, 'payout_batches');

/** One sale owed to a merchant, under a key that is paid at most once. */
export interface OwedItem {
  readonly key: string;
  readonly grossMinor: number;
}

/** A refund given from a sale (`of`), deducted from what the merchant is paid, at most once. */
export interface OwedRefund {
  readonly key: string;
  readonly of: string;
  readonly amountMinor: number;
}

/**
 * Payout batches and their items: the sales paid and the refunds deducted. A key is in at most
 * one live batch (unique index), so a sale is paid once and a refund deducted once.
 */
export const payoutLedger = {
  async insert(
    tx: Transaction,
    input: {
      readonly merchantId: string;
      readonly receiver: string;
      readonly until: Date;
      readonly items: readonly OwedItem[];
      readonly refunds: readonly OwedRefund[];
      readonly feeMinor: number;
    },
    now: Date,
  ): Promise<PayoutBatchRecord> {
    const refunds = input.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
    const gross = input.items.reduce((sum, item) => sum + item.grossMinor, 0) - refunds;
    const result = await tx.execute({
      sql: `INSERT INTO payout_batches (id, merchant_id, receiver, until, gross_minor, fee_minor,
              net_minor, refunds_minor, currency, status, created_at, updated_at, next_check_at,
              version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'unknown', ?, ?, ?, 1) RETURNING *`,
      args: [
        randomUUID(),
        input.merchantId,
        input.receiver,
        toInstant(input.until),
        gross,
        input.feeMinor,
        gross - input.feeMinor,
        refunds,
        toInstant(now),
        toInstant(now),
        toInstant(now),
      ],
    });
    const batch = toRecord(result.rows[0]);
    const lines = [
      ...input.items.map((item) => [item.key, item.grossMinor, 'sale'] as const),
      ...input.refunds.map((refund) => [refund.key, refund.amountMinor, 'refund'] as const),
    ];
    for (const [key, amountMinor, kind] of lines) {
      await tx.execute({
        sql: `INSERT INTO payout_items (batch_id, item_key, gross_minor, kind, active)
              VALUES (?, ?, ?, ?, 1)`,
        args: [batch.id, key, amountMinor, kind],
      });
    }
    return batch;
  },

  /**
   * Records what PayPal said; a batch that will not pay frees its sales, and the refunds it
   * deducted, in the same write.
   */
  async update(
    tx: Transaction,
    current: PayoutBatchRecord,
    change: {
      readonly status: PayoutStatus;
      readonly paypalBatchId?: string;
      readonly detail: string | null;
      readonly nextCheckAt: Date | null;
    },
    now: Date,
  ): Promise<PayoutBatchRecord | undefined> {
    const result = await tx.execute({
      sql: `UPDATE payout_batches SET status = ?, paypal_batch_id = COALESCE(?, paypal_batch_id),
              detail = ?, next_check_at = ?, updated_at = ?, version = version + 1
            WHERE id = ? AND version = ? RETURNING *`,
      args: [
        change.status,
        change.paypalBatchId ?? null,
        change.detail,
        change.nextCheckAt === null ? null : toInstant(change.nextCheckAt),
        toInstant(now),
        current.id,
        current.version,
      ],
    });
    if (result.rows.length === 0) return undefined;
    if (DEAD_PAYOUTS.has(change.status)) {
      await tx.execute({
        sql: 'UPDATE payout_items SET active = 0 WHERE batch_id = ?',
        args: [current.id],
      });
    }
    return toRecord(result.rows[0]);
  },

  /** Keys already in a live batch: they are not owed again. */
  async paidKeys(tx: Transaction, keys: readonly string[]): Promise<ReadonlySet<string>> {
    if (keys.length === 0) return new Set();
    const result = await tx.execute({
      sql: `SELECT item_key FROM payout_items WHERE active = 1
            AND item_key IN (${keys.map(() => '?').join(', ')})`,
      args: [...keys],
    });
    return new Set(result.rows.map((row) => parseRow(keySchema, row, 'payout_items').item_key));
  },

  async forMerchant(db: Database, merchantId: string): Promise<readonly PayoutBatchRecord[]> {
    const result = await db.query({
      sql: 'SELECT * FROM payout_batches WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50',
      args: [merchantId],
    });
    return result.rows.map(toRecord);
  },

  async due(db: Database, now: Date, limit: number): Promise<readonly PayoutBatchRecord[]> {
    const result = await db.query({
      sql: `SELECT * FROM payout_batches WHERE next_check_at IS NOT NULL AND next_check_at <= ?
            ORDER BY next_check_at LIMIT ?`,
      args: [toInstant(now), limit],
    });
    return result.rows.map(toRecord);
  },
};

const keySchema = z.object({ item_key: z.string() });
