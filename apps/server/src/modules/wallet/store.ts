import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import {
  toInstant,
  type Money,
  type PaymentPurpose,
  type TripWallet,
  type WalletMovement,
  type WalletTopUp,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { PurchaseCatalog } from '../payments/catalog.js';
import { paymentLedger, type PaymentRecord } from '../payments/ledger.js';

const CURRENCY = 'USD';
const MOVEMENTS_SHOWN = 50;
const TOP_UP_LABEL = 'Money added with PayPal';

const totalSchema = z.object({ total: z.number().nullable() });
const movementSchema = z.object({
  id: z.string(),
  kind: z.enum(['top-up', 'ticket']),
  label: z.string(),
  amount_minor: z.number(),
  at: z.string(),
  paypal_order_id: z.string().nullable(),
});

/** A reader of sums and lists: the database, or a transaction of it. */
type Reader = Pick<Transaction, 'execute'>;

const ADDED = `SELECT SUM(t.amount_minor) AS total FROM wallet_top_ups t
  JOIN payment_operations p ON p.id = t.payment_id
  WHERE t.traveller_id = ? AND p.status = 'captured'`;
const SPENT = `SELECT SUM(s.amount_minor) AS total FROM wallet_spends s
  JOIN payment_operations p ON p.id = s.payment_id
  WHERE s.traveller_id = ? AND p.status = 'captured'`;

async function sum(reader: Reader, sql: string, travellerId: string): Promise<number> {
  const result = await reader.execute({ sql, args: [travellerId] });
  return parseRow(totalSchema, result.rows[0], 'wallet total').total ?? 0;
}

const money = (amountMinor: number): Money => ({ amountMinor, currency: CURRENCY });

/** Records how much the traveller wants to add; it counts only once its payment is captured. */
export async function createTopUp(
  db: Database,
  clock: Clock,
  travellerId: string,
  amountMinor: number,
): Promise<WalletTopUp> {
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO wallet_top_ups (id, traveller_id, amount_minor, currency, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [id, travellerId, amountMinor, CURRENCY, toInstant(clock.now())],
  });
  return { id, amount: money(amountMinor), purpose: { kind: 'wallet-top-up', topUpId: id } };
}

/** The balance, the totals and the latest movements; an anonymous visitor has an empty wallet. */
export async function readWallet(
  db: Database,
  travellerId: string | undefined,
  available: boolean,
): Promise<TripWallet> {
  if (travellerId === undefined) {
    return { available, balance: money(0), added: money(0), spent: money(0), movements: [] };
  }
  const reader: Reader = { execute: (statement) => db.query(statement) };
  const added = await sum(reader, ADDED, travellerId);
  const spent = await sum(reader, SPENT, travellerId);
  const rows = await db.query({
    sql: `SELECT t.id AS id, 'top-up' AS kind, ? AS label, t.amount_minor AS amount_minor,
        p.updated_at AS at, p.paypal_order_id AS paypal_order_id
      FROM wallet_top_ups t JOIN payment_operations p ON p.id = t.payment_id
      WHERE t.traveller_id = ? AND p.status = 'captured'
      UNION ALL
      SELECT s.payment_id, 'ticket', s.label, -s.amount_minor, s.created_at, NULL
      FROM wallet_spends s JOIN payment_operations p ON p.id = s.payment_id
      WHERE s.traveller_id = ? AND p.status = 'captured'
      ORDER BY at DESC LIMIT ?`,
    args: [TOP_UP_LABEL, travellerId, travellerId, MOVEMENTS_SHOWN],
  });
  const movements = rows.rows.map((row): WalletMovement => {
    const value = parseRow(movementSchema, row, 'wallet movement');
    return {
      id: value.id,
      kind: value.kind,
      label: value.label,
      amountMinor: value.amount_minor,
      currency: CURRENCY,
      at: value.at,
      paypalOrderId: value.paypal_order_id,
    };
  });
  return {
    available,
    balance: money(added - spent),
    added: money(added),
    spent: money(spent),
    movements,
  };
}

/**
 * Pays a purchase from the balance, in one transaction: the balance is read, the payment is
 * recorded as captured with no PayPal order, the purchase is applied and the spend is written.
 * Returns undefined, with nothing written, when the balance does not cover it.
 */
export async function payFromWallet(
  deps: { readonly db: Database; readonly clock: Clock; readonly catalog: PurchaseCatalog },
  input: {
    readonly travellerId: string;
    readonly purpose: PaymentPurpose;
    readonly amount: Money;
    readonly description: string;
    readonly label: string;
  },
): Promise<PaymentRecord | undefined> {
  return deps.db.transaction(async (tx) => {
    const balance =
      (await sum(tx, ADDED, input.travellerId)) - (await sum(tx, SPENT, input.travellerId));
    if (balance < input.amount.amountMinor) return undefined;
    const now = deps.clock.now();
    const opened = await paymentLedger.insert(
      tx,
      {
        travellerId: input.travellerId,
        purpose: input.purpose,
        amount: input.amount,
        description: input.description,
        nextCheckAt: now,
      },
      'api',
      now,
    );
    const paid = await paymentLedger.update(
      tx,
      opened,
      {
        status: 'captured',
        pending: null,
        paypalStatus: 'TRIP_WALLET',
        detail: 'Paid from the trip wallet.',
        nextCheckAt: null,
      },
      'api',
      now,
    );
    await deps.catalog.fulfil(input.purpose, paid.id, tx);
    await tx.execute({
      sql: `INSERT INTO wallet_spends (payment_id, traveller_id, amount_minor, currency, label,
        created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        paid.id,
        input.travellerId,
        input.amount.amountMinor,
        input.amount.currency,
        input.label,
        toInstant(now),
      ],
    });
    return paid;
  });
}
