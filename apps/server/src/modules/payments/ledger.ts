import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import {
  paymentPurposeSchema,
  paymentStatusSchema,
  toInstant,
  type Money,
  type Payment,
  type PaymentPurpose,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { canMove, type PaymentStatus } from './transitions.js';

/** What an `unknown` payment waits for PayPal to settle. */
type Pending = 'create' | 'capture' | 'refund';

export type PaymentSource = 'api' | 'webhook' | 'reconciliation';

export interface PaymentRecord {
  readonly id: string;
  readonly travellerId: string;
  readonly purpose: PaymentPurpose;
  readonly amount: Money;
  readonly description: string;
  readonly status: PaymentStatus;
  readonly pending: Pending | null;
  readonly paypalOrderId: string | null;
  readonly paypalCaptureId: string | null;
  readonly paypalStatus: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly nextCheckAt: string | null;
  readonly checks: number;
  readonly version: number;
}

/** The fields a change may set; the others keep their value. */
export type PaymentChange = Partial<
  Pick<
    PaymentRecord,
    'status' | 'pending' | 'paypalOrderId' | 'paypalCaptureId' | 'paypalStatus' | 'detail'
  >
> & {
  readonly nextCheckAt: Date | null;
  readonly checks?: number;
};

/** Someone else changed the payment since it was read: read it again and decide again. */
export class StalePaymentError extends Error {
  constructor(id: string) {
    super(`Payment ${id} changed while it was being updated.`);
    this.name = 'StalePaymentError';
  }
}

export class PaymentTransitionError extends Error {
  constructor(id: string, from: PaymentStatus, to: PaymentStatus) {
    super(`Payment ${id} cannot go from ${from} to ${to}.`);
    this.name = 'PaymentTransitionError';
  }
}

const jsonText = z.string().transform((text, context): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    context.addIssue({ code: 'custom', message: 'is not JSON' });
    return z.NEVER;
  }
});

const rowSchema = z
  .object({
    id: z.string(),
    traveller_id: z.string(),
    purpose: jsonText.pipe(paymentPurposeSchema),
    amount_minor: z.number().int().positive(),
    currency: z.literal('USD'),
    description: z.string(),
    status: paymentStatusSchema,
    pending: z.enum(['create', 'capture', 'refund']).nullable(),
    paypal_order_id: z.string().nullable(),
    paypal_capture_id: z.string().nullable(),
    paypal_status: z.string().nullable(),
    detail: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    next_check_at: z.string().nullable(),
    checks: z.number().int(),
    version: z.number().int(),
  })
  .transform((row): PaymentRecord => ({
    id: row.id,
    travellerId: row.traveller_id,
    purpose: row.purpose,
    amount: { amountMinor: row.amount_minor, currency: row.currency },
    description: row.description,
    status: row.status,
    pending: row.pending,
    paypalOrderId: row.paypal_order_id,
    paypalCaptureId: row.paypal_capture_id,
    paypalStatus: row.paypal_status,
    detail: row.detail,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextCheckAt: row.next_check_at,
    checks: row.checks,
    version: row.version,
  }));

const toRecord = (row: unknown) => parseRow(rowSchema, row, 'payment_operations');
const first = (rows: readonly unknown[]) => (rows.length === 0 ? undefined : toRecord(rows[0]));

/** The same purchase always gives the same key, whatever the order of its fields. */
function purposeKey(purpose: PaymentPurpose): string {
  return JSON.stringify(purpose, Object.keys(purpose).sort());
}

/** The traveller's view of a payment, once PayPal has given it an order. */
export function toPayment(record: PaymentRecord): Payment | undefined {
  if (record.paypalOrderId === null) return undefined;
  return {
    id: record.id,
    paypalOrderId: record.paypalOrderId,
    status: record.status,
    amount: record.amount,
    description: record.description,
    purpose: record.purpose,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const UPDATE = `UPDATE payment_operations
SET status = :status, pending = :pending, paypal_order_id = :order, paypal_capture_id = :capture,
    paypal_status = :paypalStatus, detail = :detail, next_check_at = :nextCheckAt,
    checks = :checks, updated_at = :now, version = version + 1
WHERE id = :id AND version = :version
RETURNING *`;

/** Payments as MovIQ records them. Every change is checked, versioned and written to history. */
export const paymentLedger = {
  async insert(
    tx: Transaction,
    input: {
      readonly travellerId: string;
      readonly purpose: PaymentPurpose;
      readonly amount: Money;
      readonly description: string;
      readonly nextCheckAt: Date;
    },
    source: PaymentSource,
    now: Date,
  ): Promise<PaymentRecord> {
    const result = await tx.execute({
      sql: `INSERT INTO payment_operations (id, traveller_id, purpose, purpose_key, amount_minor,
              currency, description, status, pending, created_at, updated_at, next_check_at,
              version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', 'create', ?, ?, ?, 1) RETURNING *`,
      args: [
        randomUUID(),
        input.travellerId,
        JSON.stringify(input.purpose),
        purposeKey(input.purpose),
        input.amount.amountMinor,
        input.amount.currency,
        input.description,
        toInstant(now),
        toInstant(now),
        toInstant(input.nextCheckAt),
      ],
    });
    const record = toRecord(result.rows[0]);
    await recordHistory(tx, record, null, source, now);
    return record;
  },

  /** Applies a change only if nobody changed the payment since `current` was read. */
  async update(
    tx: Transaction,
    current: PaymentRecord,
    change: PaymentChange,
    source: PaymentSource,
    now: Date,
  ): Promise<PaymentRecord> {
    const status = change.status ?? current.status;
    if (!canMove(current.status, status)) {
      throw new PaymentTransitionError(current.id, current.status, status);
    }
    const result = await tx.execute({
      sql: UPDATE,
      args: {
        id: current.id,
        version: current.version,
        status,
        pending: change.pending === undefined ? current.pending : change.pending,
        order: change.paypalOrderId ?? current.paypalOrderId,
        capture: change.paypalCaptureId ?? current.paypalCaptureId,
        paypalStatus:
          change.paypalStatus === undefined ? current.paypalStatus : change.paypalStatus,
        detail: change.detail === undefined ? current.detail : change.detail,
        nextCheckAt: change.nextCheckAt === null ? null : toInstant(change.nextCheckAt),
        checks: change.checks ?? (status === current.status ? current.checks : 0),
        now: toInstant(now),
      },
    });
    const updated = first(result.rows);
    if (updated === undefined) throw new StalePaymentError(current.id);
    if (updated.status !== current.status || updated.pending !== current.pending) {
      await recordHistory(tx, updated, current.status, source, now);
    }
    return updated;
  },

  async find(db: Database, id: string): Promise<PaymentRecord | undefined> {
    const result = await db.query({
      sql: 'SELECT * FROM payment_operations WHERE id = ?',
      args: [id],
    });
    return first(result.rows);
  },

  async findOpen(
    tx: Transaction,
    travellerId: string,
    purpose: PaymentPurpose,
  ): Promise<PaymentRecord | undefined> {
    const result = await tx.execute({
      sql: `SELECT * FROM payment_operations WHERE traveller_id = ? AND purpose_key = ?
            AND status IN ('unknown', 'created', 'approved', 'captured')`,
      args: [travellerId, purposeKey(purpose)],
    });
    return first(result.rows);
  },

  /** The payment a PayPal order or capture belongs to, if it is one of MovIQ's. */
  async findByPayPal(
    db: Database,
    ids: { readonly orderId?: string | undefined; readonly captureId?: string | undefined },
  ): Promise<PaymentRecord | undefined> {
    const result = await db.query({
      sql: 'SELECT * FROM payment_operations WHERE paypal_order_id = ? OR paypal_capture_id = ?',
      args: [ids.orderId ?? null, ids.captureId ?? null],
    });
    return first(result.rows);
  },

  /** Payments whose next look at PayPal is due, oldest first. */
  async due(db: Database, now: Date, limit: number): Promise<readonly PaymentRecord[]> {
    const result = await db.query({
      sql: `SELECT * FROM payment_operations WHERE next_check_at IS NOT NULL AND next_check_at <= ?
            ORDER BY next_check_at LIMIT ?`,
      args: [toInstant(now), limit],
    });
    return result.rows.map(toRecord);
  },

  /**
   * Records a refund PayPal made. A refund already recorded, under this operation or by its
   * PayPal id, is left as it is, so repeating an answer never counts the money twice.
   */
  async recordRefund(
    tx: Transaction,
    refund: {
      readonly paymentId: string;
      readonly operation: string;
      readonly paypalRefundId: string;
      readonly amount: Money;
      readonly paypalStatus: string;
    },
    now: Date,
  ): Promise<void> {
    await tx.execute({
      sql: `INSERT INTO payment_refunds (payment_id, operation, paypal_refund_id, amount_minor,
              currency, paypal_status, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [
        refund.paymentId,
        refund.operation,
        refund.paypalRefundId,
        refund.amount.amountMinor,
        refund.amount.currency,
        refund.paypalStatus,
        toInstant(now),
      ],
    });
  },
};

async function recordHistory(
  tx: Transaction,
  record: PaymentRecord,
  from: PaymentStatus | null,
  source: PaymentSource,
  now: Date,
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO payment_history (payment_id, at, from_status, to_status, source, detail)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [record.id, toInstant(now), from, record.status, source, record.detail],
  });
}
