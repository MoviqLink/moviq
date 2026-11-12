import type { MoneyObligationKind } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/**
 * One amount MovIQ has not settled with PayPal, as the ledger holds it. Read only: nothing here
 * changes what reconciliation does with it.
 */
export interface OpenObligation {
  readonly id: string;
  readonly kind: MoneyObligationKind;
  readonly reference: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly since: string;
  readonly attempts: number | null;
  readonly detail: string | null;
  readonly nextCheckAt: string | null;
}

const rowSchema = z.object({
  id: z.string(),
  amount_minor: z.number().int(),
  since: z.string(),
  attempts: z.number().int().nonnegative().nullable(),
  detail: z.string().nullable(),
  next_check_at: z.string().nullable(),
  status: z.string(),
});

/** Each query answers the columns of `rowSchema`; the kind and the reference are added here. */
interface Reading {
  readonly kind: MoneyObligationKind;
  readonly table: string;
  readonly sql: string;
  readonly reference: (id: string) => string;
}

const READINGS: readonly Reading[] = [
  {
    kind: 'hold-release',
    table: 'payment_hold_releases',
    reference: (id) => `hold ${id}`,
    sql: `SELECT r.hold_id AS id, h.amount_minor, r.created_at AS since, r.checks AS attempts,
            r.detail, r.next_check_at, r.status
          FROM payment_hold_releases r JOIN payment_holds h ON h.id = r.hold_id
          WHERE r.status = 'owed'`,
  },
  {
    kind: 'refund',
    table: 'payment_hold_refunds',
    reference: (id) => `hold ${id.replace(':', ' · ')}`,
    sql: `SELECT hold_id || ':' || operation AS id, amount_minor, created_at AS since,
            checks AS attempts, detail, next_check_at, status
          FROM payment_hold_refunds WHERE status = 'unknown'`,
  },
  // An order still being opened has moved no money, so only a capture, refund, authorization or
  // void whose answer never arrived is in doubt.
  {
    kind: 'payment',
    table: 'payment_operations',
    reference: (id) => `payment ${id}`,
    sql: `SELECT p.id, p.amount_minor, p.checks AS attempts, p.detail, p.next_check_at,
            'unknown · ' || p.pending AS status,
            COALESCE((SELECT MAX(h.at) FROM payment_history h
              WHERE h.payment_id = p.id AND h.to_status = 'unknown'), p.created_at) AS since
          FROM payment_operations p WHERE p.status = 'unknown' AND p.pending <> 'create'`,
  },
  // A hold whose release is owed is listed once, as that release.
  {
    kind: 'payment',
    table: 'payment_holds',
    reference: (id) => `hold ${id}`,
    sql: `SELECT p.id, p.amount_minor, p.checks AS attempts, p.detail, p.next_check_at,
            'unknown · ' || p.pending AS status,
            COALESCE((SELECT MAX(h.at) FROM payment_hold_history h
              WHERE h.hold_id = p.id AND h.to_status = 'unknown' AND h.pending = p.pending),
              p.created_at) AS since
          FROM payment_holds p WHERE p.status = 'unknown' AND p.pending <> 'create'
            AND NOT EXISTS (SELECT 1 FROM payment_hold_releases r
              WHERE r.hold_id = p.id AND r.status = 'owed')`,
  },
  // The ledger does not count looks at a batch: its age alone says how long PayPal has kept it.
  {
    kind: 'payout-batch',
    table: 'payout_batches',
    reference: (id) => `batch ${id}`,
    sql: `SELECT id, net_minor AS amount_minor, created_at AS since, NULL AS attempts, detail,
            next_check_at, status
          FROM payout_batches WHERE status IN ('unknown', 'pending', 'processing')`,
  },
];

/** Every release, refund, payment and payout batch PayPal has not settled yet. */
export async function openObligations(db: Database): Promise<readonly OpenObligation[]> {
  const read = await Promise.all(READINGS.map((reading) => readOne(db, reading)));
  return read.flat();
}

async function readOne(db: Database, reading: Reading): Promise<readonly OpenObligation[]> {
  const result = await db.query(reading.sql);
  return result.rows.map((raw) => {
    const row = parseRow(rowSchema, raw, reading.table);
    return {
      id: `${reading.kind}:${row.id}`,
      kind: reading.kind,
      reference: reading.reference(row.id),
      status: row.status,
      amountMinor: row.amount_minor,
      since: row.since,
      attempts: row.attempts,
      detail: row.detail,
      nextCheckAt: row.next_check_at,
    };
  });
}
