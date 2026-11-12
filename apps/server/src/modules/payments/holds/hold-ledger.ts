import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import { holdPurposeSchema, toInstant, type HoldPurpose, type Money } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/database/database.js';
import { parseRow } from '../../../infrastructure/database/rows.js';
import type { OrderPresentation } from '../paypal/gateway.js';
import { canMoveHold, type HoldPending, type HoldStatus } from './hold-transitions.js';

export type HoldSource = 'api' | 'reconciliation';

export interface HoldRecord {
  readonly id: string;
  readonly travellerId: string;
  readonly purpose: HoldPurpose;
  readonly amount: Money;
  readonly description: string;
  readonly presentation: OrderPresentation;
  readonly status: HoldStatus;
  readonly pending: HoldPending | null;
  readonly paypalOrderId: string | null;
  readonly paypalAuthorizationId: string | null;
  readonly paypalCaptureId: string | null;
  readonly capturedMinor: number;
  readonly paypalStatus: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
  readonly nextCheckAt: string | null;
  readonly checks: number;
  readonly version: number;
}

/** The fields a change may set; the others keep their value. */
export type HoldChange = Partial<
  Pick<
    HoldRecord,
    | 'status'
    | 'pending'
    | 'paypalOrderId'
    | 'paypalAuthorizationId'
    | 'paypalCaptureId'
    | 'capturedMinor'
    | 'paypalStatus'
    | 'detail'
  >
> & { readonly nextCheckAt: Date | null; readonly checks?: number };

/** Someone else changed the hold since it was read: read it again and decide again. */
export class StaleHoldError extends Error {
  constructor(id: string) {
    super(`Hold ${id} changed while it was being updated.`);
    this.name = 'StaleHoldError';
  }
}

export class HoldTransitionError extends Error {
  constructor(id: string, from: HoldStatus, to: HoldStatus) {
    super(`Hold ${id} cannot go from ${from} to ${to}.`);
    this.name = 'HoldTransitionError';
  }
}

const money = z.object({ amountMinor: z.number().int(), currency: z.literal('USD') });
const presentationSchema = z.object({
  brandName: z.string().min(1),
  locale: z.enum(['en-US', 'es-US']),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().positive(),
      unitAmount: money,
      category: z.enum(['PHYSICAL_GOODS', 'DIGITAL_GOODS']),
    }),
  ),
  discount: money,
});

const json = <T>(schema: z.ZodType<T>) =>
  z.string().transform((text, context): T => {
    const parsed = schema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  });

const rowSchema = z
  .object({
    id: z.string(),
    traveller_id: z.string(),
    purpose: json(holdPurposeSchema),
    amount_minor: z.number().int().positive(),
    currency: z.literal('USD'),
    description: z.string(),
    presentation: json(presentationSchema),
    status: z.enum(['unknown', 'created', 'authorized', 'captured', 'voided', 'failed']),
    pending: z.enum(['create', 'authorize', 'capture', 'void']).nullable(),
    paypal_order_id: z.string().nullable(),
    paypal_authorization_id: z.string().nullable(),
    paypal_capture_id: z.string().nullable(),
    captured_minor: z.number().int().nonnegative(),
    paypal_status: z.string().nullable(),
    detail: z.string().nullable(),
    created_at: z.string(),
    next_check_at: z.string().nullable(),
    checks: z.number().int(),
    version: z.number().int(),
  })
  .transform((row): HoldRecord => ({
    id: row.id,
    travellerId: row.traveller_id,
    purpose: row.purpose,
    amount: { amountMinor: row.amount_minor, currency: row.currency },
    description: row.description,
    presentation: row.presentation,
    status: row.status,
    pending: row.pending,
    paypalOrderId: row.paypal_order_id,
    paypalAuthorizationId: row.paypal_authorization_id,
    paypalCaptureId: row.paypal_capture_id,
    capturedMinor: row.captured_minor,
    paypalStatus: row.paypal_status,
    detail: row.detail,
    createdAt: row.created_at,
    nextCheckAt: row.next_check_at,
    checks: row.checks,
    version: row.version,
  }));

const toRecord = (row: unknown) => parseRow(rowSchema, row, 'payment_holds');
const first = (rows: readonly unknown[]) => (rows.length === 0 ? undefined : toRecord(rows[0]));

export const purposeKey = (purpose: HoldPurpose): string => `${purpose.kind}:${purpose.offerId}`;

const UPDATE = `UPDATE payment_holds
SET status = :status, pending = :pending, paypal_order_id = :order,
    paypal_authorization_id = :authorization, paypal_capture_id = :capture,
    captured_minor = :captured, paypal_status = :paypalStatus, detail = :detail,
    next_check_at = :nextCheckAt, checks = :checks, updated_at = :now, version = version + 1
WHERE id = :id AND version = :version
RETURNING *`;

/** Holds as MovIQ records them. Every change is checked, versioned and written to history. */
export const holdLedger = {
  async insert(
    tx: Transaction,
    input: Pick<HoldRecord, 'travellerId' | 'purpose' | 'amount' | 'description' | 'presentation'>,
    nextCheckAt: Date,
    now: Date,
  ): Promise<HoldRecord> {
    const result = await tx.execute({
      sql: `INSERT INTO payment_holds (id, traveller_id, purpose, purpose_key, amount_minor,
              currency, description, presentation, status, pending, created_at, updated_at,
              next_check_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'create', ?, ?, ?, 1) RETURNING *`,
      args: [
        randomUUID(),
        input.travellerId,
        JSON.stringify(input.purpose),
        purposeKey(input.purpose),
        input.amount.amountMinor,
        input.amount.currency,
        input.description,
        JSON.stringify(input.presentation),
        toInstant(now),
        toInstant(now),
        toInstant(nextCheckAt),
      ],
    });
    const record = toRecord(result.rows[0]);
    await recordHistory(tx, record, null, 'api', now);
    return record;
  },

  /** Applies a change only if nobody changed the hold since `current` was read. */
  async update(
    tx: Transaction,
    current: HoldRecord,
    change: HoldChange,
    source: HoldSource,
    now: Date,
  ): Promise<HoldRecord> {
    const status = change.status ?? current.status;
    if (!canMoveHold(current.status, status)) {
      throw new HoldTransitionError(current.id, current.status, status);
    }
    const result = await tx.execute({
      sql: UPDATE,
      args: {
        id: current.id,
        version: current.version,
        status,
        pending: change.pending === undefined ? current.pending : change.pending,
        order: change.paypalOrderId ?? current.paypalOrderId,
        authorization: change.paypalAuthorizationId ?? current.paypalAuthorizationId,
        capture: change.paypalCaptureId ?? current.paypalCaptureId,
        captured: change.capturedMinor ?? current.capturedMinor,
        paypalStatus:
          change.paypalStatus === undefined ? current.paypalStatus : change.paypalStatus,
        detail: change.detail === undefined ? current.detail : change.detail,
        nextCheckAt: change.nextCheckAt === null ? null : toInstant(change.nextCheckAt),
        checks: change.checks ?? (status === current.status ? current.checks : 0),
        now: toInstant(now),
      },
    });
    const updated = first(result.rows);
    if (updated === undefined) throw new StaleHoldError(current.id);
    if (updated.status !== current.status || updated.pending !== current.pending) {
      await recordHistory(tx, updated, current.status, source, now);
    }
    return updated;
  },

  async find(db: Database | Transaction, id: string): Promise<HoldRecord | undefined> {
    const statement = { sql: 'SELECT * FROM payment_holds WHERE id = ?', args: [id] };
    const result = 'query' in db ? await db.query(statement) : await db.execute(statement);
    return first(result.rows);
  },

  async findOpen(
    tx: Transaction,
    travellerId: string,
    purpose: HoldPurpose,
  ): Promise<HoldRecord | undefined> {
    const result = await tx.execute({
      sql: `SELECT * FROM payment_holds WHERE traveller_id = ? AND purpose_key = ?
            AND status IN ('unknown', 'created', 'authorized', 'captured')`,
      args: [travellerId, purposeKey(purpose)],
    });
    return first(result.rows);
  },

  /** Holds whose next look at PayPal is due, oldest first. */
  async due(db: Database, now: Date, limit: number): Promise<readonly HoldRecord[]> {
    const result = await db.query({
      sql: `SELECT * FROM payment_holds WHERE next_check_at IS NOT NULL AND next_check_at <= ?
            ORDER BY next_check_at LIMIT ?`,
      args: [toInstant(now), limit],
    });
    return result.rows.map(toRecord);
  },
};

async function recordHistory(
  tx: Transaction,
  record: HoldRecord,
  from: HoldStatus | null,
  source: HoldSource,
  now: Date,
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO payment_hold_history (hold_id, at, from_status, to_status, pending, source,
            detail) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [record.id, toInstant(now), from, record.status, record.pending, source, record.detail],
  });
}
