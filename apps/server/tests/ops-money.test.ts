import { fileURLToPath } from 'node:url';

import { moneyInDoubtSchema, type MoneyInDoubt } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { MONEY_THRESHOLDS, moneyInDoubt } from '../src/modules/operations/money-in-doubt.js';
import { safeDetail } from '../src/modules/operations/safe-detail.js';
import { commerceWorld, type CommerceWorld } from './commerce/support/commerce.js';
import { collectedOrder, fakePayouts } from './commerce/support/orders.js';
import { addTraveller } from './payments/support/payments.js';
import { ADMIN_TOKEN, testApp, VIEWER_TOKEN } from './support/app.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = '2026-11-11T12:00:00.000Z';

let temp: TempDatabase | undefined;
let world: CommerceWorld | undefined;

afterEach(async () => {
  await temp?.dispose();
  await world?.temp.dispose();
  temp = undefined;
  world = undefined;
});

async function control(): Promise<{
  db: Database;
  clock: ManualClock;
  app: ReturnType<typeof testApp>['app'];
}> {
  const clock = manualClock(T0);
  temp = await tempDatabase();
  const db = await temp.open();
  const migrations = await readMigrations(
    fileURLToPath(new URL('../migrations/', import.meta.url)),
  );
  await migrate(db, migrations, clock);
  return { db, clock, app: testApp({ db, migrations, clock }).app };
}

interface Row {
  readonly id: string;
  readonly pending: string;
  readonly checks?: number;
  readonly detail?: string | null;
}

async function payment(db: Database, traveller: string, row: Row): Promise<void> {
  await db.execute({
    sql: `INSERT INTO payment_operations (id, traveller_id, purpose, purpose_key, amount_minor,
            currency, description, status, pending, detail, created_at, updated_at, next_check_at,
            checks, version)
          VALUES (?, ?, 'journey-alternative', ?, 2140, 'USD', 'Taxi to JFK', 'unknown', ?, ?, ?,
            ?, ?, ?, 1)`,
    args: [row.id, traveller, row.id, row.pending, row.detail ?? null, T0, T0, T0, row.checks ?? 0],
  });
}

async function hold(db: Database, traveller: string, row: Row & { amount?: number }) {
  await db.execute({
    sql: `INSERT INTO payment_holds (id, traveller_id, purpose, purpose_key, amount_minor, currency,
            description, presentation, status, pending, detail, created_at, updated_at,
            next_check_at, checks, version)
          VALUES (?, ?, 'pickup', ?, ?, 'USD', 'Ramen', '{}', 'unknown', ?, ?, ?, ?, ?, ?, 1)`,
    args: [
      row.id,
      traveller,
      row.id,
      row.amount ?? 1695,
      row.pending,
      row.detail ?? null,
      T0,
      T0,
      T0,
      row.checks ?? 0,
    ],
  });
}

/** One of each kind PayPal has not settled, plus what must not be listed. */
async function ledger(db: Database, clock: ManualClock): Promise<void> {
  const traveller = await addTraveller(db, clock);
  await payment(db, traveller, { id: 'pay-capture', pending: 'capture', checks: 2 });
  await payment(db, traveller, { id: 'pay-opening', pending: 'create' });
  await hold(db, traveller, { id: 'hold-capture', pending: 'capture' });
  await hold(db, traveller, { id: 'hold-refused', pending: 'void', amount: 1200 });
  await db.execute({
    sql: `INSERT INTO payment_hold_releases (hold_id, reason, status, checks, next_check_at, detail,
            created_at, updated_at) VALUES ('hold-refused', 'kitchen full', 'owed', 6, ?, ?, ?, ?)`,
    args: [T0, 'authorizations.void: unknown, HTTP 503', T0, T0],
  });
  await hold(db, traveller, { id: 'hold-refunding', pending: 'capture' });
  await db.execute(
    "UPDATE payment_holds SET status = 'captured', pending = NULL, captured_minor = 1695 WHERE id = 'hold-refunding'",
  );
  await db.execute({
    sql: `INSERT INTO payment_hold_refunds (hold_id, operation, amount_minor, currency, status,
            created_at, updated_at, checks, next_check_at) VALUES ('hold-refunding', 'line-0', 450,
            'USD', 'unknown', ?, ?, 9, ?)`,
    args: [T0, T0, T0],
  });
  await db.execute({
    sql: `INSERT INTO payout_batches (id, merchant_id, receiver, until, gross_minor, fee_minor,
            net_minor, currency, status, created_at, updated_at, next_check_at, version)
          VALUES ('batch-1', 'demo-tsuki-ramen-house', 'r@example.com', ?, 3000, 150, 2850, 'USD',
            'processing', ?, ?, ?, 1)`,
    args: [T0, T0, T0, T0],
  });
}

const kinds = (money: MoneyInDoubt) =>
  money.obligations.map((item) => [item.kind, item.reference, item.status, item.escalation]);

describe('money in doubt', () => {
  it('needs a control room session', async () => {
    const { app } = await control();
    expect((await app.request('/api/ops/money')).status).toBe(401);
    const forged = await app.request('/api/ops/money', { headers: { cookie: 'moviq_ops=forged' } });
    expect(forged.status).toBe(401);
  });

  it('lists each kind with its status, and escalates at the thresholds', async () => {
    const { db, clock, app } = await control();
    await ledger(db, clock);
    const login = await app.request('/api/ops/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: VIEWER_TOKEN }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    clock.advance(30 * MINUTE);
    const answer = await app.request('/api/ops/money', { headers: { cookie } });
    expect(answer.status).toBe(200);
    const money = moneyInDoubtSchema.parse(await answer.json());
    expect(kinds(money)).toEqual([
      ['hold-release', 'hold hold-refused', 'owed', 'attempts'],
      ['refund', 'hold hold-refunding · line-0', 'unknown', null],
      ['payment', 'payment pay-capture', 'unknown · capture', null],
      ['payment', 'hold hold-capture', 'unknown · capture', null],
      ['payout-batch', 'batch batch-1', 'processing', null],
    ]);
    expect(money.totals).toEqual({
      open: 5,
      escalated: 1,
      amount: { amountMinor: 1200 + 2140 + 1695 + 450 + 2850, currency: 'USD' },
    });
    expect(money.obligations[1]?.attempts).toBe(9);
    expect(money.obligations[4]?.attempts).toBeNull();
    expect(money.thresholds).toEqual(MONEY_THRESHOLDS);

    clock.advance(HOUR - 30 * MINUTE - 1);
    expect((await moneyInDoubt({ db, clock })).totals.escalated).toBe(1);
    clock.advance(1);
    const hour = await moneyInDoubt({ db, clock });
    expect(hour.obligations.map((item) => item.escalation)).toEqual([
      'attempts',
      'age',
      'age',
      null,
      null,
    ]);
    clock.advance(23 * HOUR);
    expect((await moneyInDoubt({ db, clock })).totals.escalated).toBe(5);
  });

  it('shows what PayPal said without card data, email addresses or secrets', async () => {
    const { db, clock } = await control();
    await ledger(db, clock);
    const leak =
      'payouts.create: refused, HTTP 422, RECEIVER_UNREGISTERED, debug id f2a1b3c4d5e6 ' +
      'for ana.perez@example.com, card 4111 1111 1111 1111, Bearer A21AAx.y-z, client_secret=shh';
    await db.execute({
      sql: "UPDATE payout_batches SET detail = ? WHERE id = 'batch-1'",
      args: [leak],
    });
    const shown = (await moneyInDoubt({ db, clock })).obligations.find(
      (item) => item.kind === 'payout-batch',
    );
    expect(shown?.lastError).toBe(
      'payouts.create: refused, HTTP 422, RECEIVER_UNREGISTERED, debug id f2a1b3c4d5e6 for ' +
        '[email], card [card], [secret], client_secret=[secret]',
    );
    expect(safeDetail('   ')).toBeNull();
    expect(safeDetail(`a\n${'x'.repeat(400)}`)?.length).toBe(240);
  });

  it('answers an empty list when everything is settled', async () => {
    const { app } = await control();
    const login = await app.request('/api/ops/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const money = moneyInDoubtSchema.parse(
      await (await app.request('/api/ops/money', { headers: { cookie } })).json(),
    );
    expect(money.obligations).toEqual([]);
    expect(money.totals).toEqual({
      open: 0,
      escalated: 0,
      amount: { amountMinor: 0, currency: 'USD' },
    });
  });

  it('lists what a merchant owes for a refund after its payout, until the next payouts', async () => {
    world = await commerceWorld({ payouts: fakePayouts({ value: 'SUCCESS' }) });
    const { order, merchant } = await collectedOrder(world);
    expect((await merchant.post('/api/merchant/payouts/now')).status).toBe(201);
    world.clock.advance(5 * MINUTE);
    const refund = await merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [0] });
    const refunded = z
      .object({ refunded: z.object({ amountMinor: z.number() }) })
      .parse(refund.body).refunded.amountMinor;
    const refundedAt = world.clock.now().toISOString();
    const money = await moneyInDoubt({ db: world.db, clock: world.clock });
    expect(money.obligations).toEqual([
      {
        id: 'merchant-balance:demo-tsuki-ramen-house',
        kind: 'merchant-balance',
        reference: 'merchant demo-tsuki-ramen-house',
        status: 'owed',
        amount: { amountMinor: refunded, currency: 'USD' },
        since: refundedAt,
        attempts: null,
        lastError: null,
        nextCheckAt: '2026-11-16T05:00:00.000Z',
        escalation: null,
      },
    ]);
    world.clock.advance(14 * 24 * HOUR);
    expect(
      (await moneyInDoubt({ db: world.db, clock: world.clock })).obligations[0]?.escalation,
    ).toBe('age');
  });
});
