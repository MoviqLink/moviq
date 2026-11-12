import { paymentStatusSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { parseRow } from '../../src/infrastructure/database/rows.js';
import { providerEvents } from '../../src/modules/payments/events.js';
import {
  paymentLedger,
  PaymentTransitionError,
  StalePaymentError,
} from '../../src/modules/payments/ledger.js';
import { PAYMENT_TRANSITIONS, type PaymentStatus } from '../../src/modules/payments/transitions.js';
import { manualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { addTraveller, alternative, count, paymentsDatabase } from './support/payments.js';

const clock = manualClock();
const STATUSES = paymentStatusSchema.options;
let temp: TempDatabase;
let db: Database;
let travellerId: string;

beforeEach(async () => {
  ({ temp, db } = await paymentsDatabase(clock));
  travellerId = await addTraveller(db, clock);
});

afterEach(async () => {
  await temp.dispose();
});

const insert = (purpose = alternative()) =>
  db.transaction((tx) =>
    paymentLedger.insert(
      tx,
      {
        travellerId,
        purpose,
        amount: { amountMinor: 2140, currency: 'USD' },
        description: 'Taxi to JFK',
        nextCheckAt: clock.now(),
      },
      'api',
      clock.now(),
    ),
  );

/** Puts a payment in any status, as only a test may: the trigger is set aside meanwhile. */
async function forceStatus(id: string, status: PaymentStatus): Promise<void> {
  const trigger = await db.query(
    "SELECT sql FROM sqlite_master WHERE name = 'payment_operations_allowed_transition'",
  );
  const sql = z.object({ sql: z.string() }).parse(trigger.rows[0]).sql;
  await db.execute('DROP TRIGGER payment_operations_allowed_transition');
  await db.execute({
    sql: 'UPDATE payment_operations SET status = ?, pending = ? WHERE id = ?',
    args: [status, status === 'unknown' ? 'capture' : null, id],
  });
  await db.execute(sql);
}

const moveTo = (id: string, status: PaymentStatus) =>
  db.execute({
    sql: 'UPDATE payment_operations SET status = ?, pending = ? WHERE id = ?',
    args: [status, status === 'unknown' ? 'capture' : null, id],
  });

const transitionRows = z.object({ from_status: z.string(), to_status: z.string() });

describe('payment status transitions', () => {
  it('are the same in the code and in the database', async () => {
    const result = await db.query('SELECT from_status, to_status FROM payment_status_transitions');
    const stored = result.rows
      .map((row) => parseRow(transitionRows, row, 'transitions'))
      .map((row) => `${row.from_status}->${row.to_status}`)
      .sort();
    const coded = STATUSES.flatMap((from) =>
      PAYMENT_TRANSITIONS[from].map((to) => `${from}->${to}`),
    ).sort();
    expect(stored).toEqual(coded);
  });

  it('cannot skip a step: the database refuses every change that is not listed', async () => {
    const pairs = STATUSES.flatMap((from) => STATUSES.map((to) => [from, to] as const)).filter(
      ([from, to]) => from !== to,
    );
    for (const [from, to] of pairs) {
      const payment = await insert(alternative(`${from}-${to}`));
      await forceStatus(payment.id, from);
      if (PAYMENT_TRANSITIONS[from].includes(to))
        await expect(moveTo(payment.id, to)).resolves.toBeDefined();
      else
        await expect(moveTo(payment.id, to)).rejects.toThrow(
          /payment status transition not allowed/,
        );
    }
    expect(pairs).toHaveLength(56);
  });

  it('every payment starts unknown', async () => {
    await expect(
      db.execute({
        sql: `INSERT INTO payment_operations (id, traveller_id, purpose, purpose_key, amount_minor,
                currency, description, status, pending, created_at, updated_at, version)
              VALUES ('x', ?, '{}', 'k', 100, 'USD', 'd', 'captured', NULL, 'a', 'a', 1)`,
        args: [travellerId],
      }),
    ).rejects.toThrow(/a payment starts unknown/);
  });

  it('the code refuses a change the table does not list, before touching the database', async () => {
    const payment = await insert();
    await forceStatus(payment.id, 'failed');
    const failed = await paymentLedger.find(db, payment.id);
    if (failed === undefined) throw new Error('payment not found');
    await expect(
      db.transaction((tx) =>
        paymentLedger.update(
          tx,
          failed,
          { status: 'captured', nextCheckAt: null },
          'api',
          clock.now(),
        ),
      ),
    ).rejects.toThrow(PaymentTransitionError);
  });
});

describe('the payment ledger', () => {
  it('applies a change only to the version it read (optimistic concurrency)', async () => {
    const payment = await insert();
    const change = {
      status: 'created',
      pending: null,
      paypalOrderId: 'ORDER1',
      nextCheckAt: null,
    } as const;
    const updated = await db.transaction((tx) =>
      paymentLedger.update(tx, payment, change, 'api', clock.now()),
    );
    expect(updated.version).toBe(2);
    await expect(
      db.transaction((tx) => paymentLedger.update(tx, payment, change, 'api', clock.now())),
    ).rejects.toThrow(StalePaymentError);
    expect(
      await count(db, 'SELECT COUNT(*) AS n FROM payment_history WHERE payment_id = ?', [
        payment.id,
      ]),
    ).toBe(2);
  });

  it('keeps one open payment per traveller and purchase', async () => {
    await insert();
    await expect(insert()).rejects.toThrow(/UNIQUE/);
    await insert(alternative('taxi-2'));
    expect(await count(db, 'SELECT COUNT(*) AS n FROM payment_operations')).toBe(2);
  });

  it('records each PayPal refund once, and tells two equal refunds apart by operation', async () => {
    const payment = await insert();
    const refund = (operation: string, paypalRefundId: string) =>
      db.transaction((tx) =>
        paymentLedger.recordRefund(
          tx,
          {
            paymentId: payment.id,
            operation,
            paypalRefundId,
            amount: { amountMinor: 1000, currency: 'USD' },
            paypalStatus: 'COMPLETED',
          },
          clock.now(),
        ),
      );
    await refund('refund:1', 'R1');
    await refund('refund:2', 'R2');
    // Repeating an operation, or meeting the same PayPal refund under another name, adds nothing.
    await refund('refund:2', 'R2');
    await refund('paypal:R2', 'R2');
    expect(
      await count(db, 'SELECT SUM(amount_minor) AS n FROM payment_refunds WHERE payment_id = ?', [
        payment.id,
      ]),
    ).toBe(2000);
  });
});

describe('provider events', () => {
  it('are processed once: only a processed event counts as already handled', async () => {
    const event = { id: 'WH-1', type: 'CHECKOUT.ORDER.APPROVED' };
    expect(await providerEvents.receive(db, event, clock.now())).toEqual({ processed: false });
    expect(await providerEvents.receive(db, event, clock.now())).toEqual({ processed: false });
    await db.transaction((tx) =>
      providerEvents.markProcessed(tx, 'WH-1', 'unmatched', null, clock.now()),
    );
    expect(await providerEvents.receive(db, event, clock.now())).toEqual({ processed: true });
    expect(await count(db, 'SELECT deliveries AS n FROM provider_events')).toBe(3);
  });
});
