import { fileURLToPath } from 'node:url';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { needViewSchema, orderViewSchema, reservationSchema } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { commercePurchases } from '../../src/modules/commerce/hold-purchases.js';
import type { HoldContext } from '../../src/modules/payments/holds/hold-context.js';
import { reconcileRound } from '../../src/modules/payments/holds/hold-reconcile.js';
import { testApp } from '../support/app.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';
import { CLIENT_ID } from '../payments/support/api.js';
import { fakeHoldPayPal, type FakeHoldPayPal } from '../payments/support/fake-paypal-holds.js';
import { browser, EVENING, needRequest } from './support/commerce.js';

/**
 * The whole application over one database with PayPal in memory, as the process runs it.
 * `restart` puts a new instance of the application on the same database and the same PayPal,
 * as after a deploy or a crash; the browsers keep their cookies and talk to the new one.
 */
interface Mounted {
  readonly db: Database;
  readonly clock: ManualClock;
  readonly paypal: FakeHoldPayPal;
  readonly traveller: ReturnType<typeof browser>;
  readonly merchant: ReturnType<typeof browser>;
  restart(): void;
}

let temp: TempDatabase | undefined;

afterEach(async () => {
  await temp?.dispose();
  temp = undefined;
});

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

async function mounted(): Promise<Mounted> {
  const clock = manualClock(EVENING);
  temp = await tempDatabase();
  const db = await temp.open();
  const migrations = await readMigrations(MIGRATIONS);
  await migrate(db, migrations, clock);
  const paypal = fakeHoldPayPal();
  const payments = {
    available: true,
    paypal,
    config: { available: true, clientId: CLIENT_ID, environment: 'sandbox', currency: 'USD' },
    webhookId: undefined,
  } as const;
  const start = () => testApp({ db, migrations, clock, payments }).app;
  let app = start();
  const merchant = browser(() => app);
  await merchant.post('/api/merchant/session', {
    token: MERCHANT_TEST_TOKEN,
    merchantId: 'demo-tsuki-ramen-house',
  });
  return {
    db,
    clock,
    paypal,
    traveller: browser(() => app),
    merchant,
    restart: () => {
      app = start();
    },
  };
}

async function reserved(world: Mounted) {
  const need = needViewSchema.parse(
    (await world.traveller.post('/api/commerce/needs', needRequest())).body,
  );
  const offerId = need.offers[0]?.id ?? '';
  const reservation = reservationSchema.parse(
    (await world.traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' }))
      .body,
  );
  return { offerId, reservation };
}

async function confirmed(world: Mounted) {
  const { offerId, reservation } = await reserved(world);
  world.paypal.approve(reservation.paypalOrderId);
  const answer = await world.traveller.post(`/api/commerce/offers/${offerId}/confirm`);
  return { offerId, reservation, order: orderViewSchema.parse(answer.body) };
}

const calls = (world: Mounted, method: string) =>
  world.paypal.calls.filter((call) => call.method === method).length;
const orders = async (world: Mounted) =>
  (await world.db.query('SELECT id FROM commerce_orders')).rows.length;
const confirm = (world: Mounted, offerId: string) =>
  world.traveller.post(`/api/commerce/offers/${offerId}/confirm`);
const scan = (world: Mounted, code: string | undefined) =>
  world.merchant.post('/api/merchant/scan', { code });

/** The worker's reconciliation, run by whichever instance holds the lease. */
async function reconcile(world: Mounted): Promise<void> {
  const ctx: HoldContext = {
    db: world.db,
    clock: world.clock,
    logger: memoryLogger().logger,
    paypal: world.paypal,
    purchases: commercePurchases({ clock: world.clock }),
    source: 'reconciliation',
    write: (work) => world.db.transaction(work),
  };
  await reconcileRound(ctx, { signal: AbortSignal.timeout(5000) }, 50);
}

describe('the mounted app under adverse conditions charges and hands over once', () => {
  it('holds nothing and creates no order when the buyer turns the payment down', async () => {
    const world = await mounted();
    const { offerId, reservation } = await reserved(world);
    const answers = await Promise.all([confirm(world, offerId), confirm(world, offerId)]);
    expect(answers.map((answer) => answer.status)).toEqual([409, 409]);
    expect(await orders(world)).toBe(0);
    expect(world.paypal.order(reservation.paypalOrderId)?.authorization).toBeUndefined();
    world.clock.advance(60 * 60_000);
    await reconcile(world);
    expect(await orders(world)).toBe(0);
    expect(world.paypal.order(reservation.paypalOrderId)?.authorization).toBeUndefined();
  });

  it('reserves, confirms, scans and refunds once however often and at once they are sent', async () => {
    const world = await mounted();
    const need = needViewSchema.parse(
      (await world.traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    const reserve = () =>
      world.traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' });
    const [first, second] = await Promise.all([reserve(), reserve()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    const creations = world.paypal.calls.filter((call) => call.method === 'createOrder');
    expect(new Set(creations.map((call) => call.requestId)).size).toBe(1);
    const reservation = reservationSchema.parse(first.body);
    expect(reservationSchema.parse(second.body).paypalOrderId).toBe(reservation.paypalOrderId);
    world.paypal.approve(reservation.paypalOrderId);
    const confirmations = await Promise.all([1, 2, 3].map(() => confirm(world, offerId)));
    expect(confirmations.some((answer) => answer.status === 200)).toBe(true);
    expect(await orders(world)).toBe(1);
    const order = orderViewSchema.parse((await confirm(world, offerId)).body);
    const scans = await Promise.all([scan(world, order.pickup?.qr), scan(world, order.pickup?.qr)]);
    // A scan racing the first one is told of the same single charge; it never charges again.
    expect(scans.map((answer) => answer.status)).toContain(200);
    expect(scans.every((answer) => answer.status === 200 || answer.status === 409)).toBe(true);
    expect((await scan(world, order.pickup?.qr)).status).toBe(409);
    expect(world.paypal.captures()).toBe(1);
    const refund = () =>
      world.merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [0] });
    await Promise.all([refund(), refund()]);
    await refund();
    expect(world.paypal.refunds()).toBe(1);
    const handedOver = await world.db.query(
      "SELECT id FROM commerce_orders WHERE status = 'picked_up'",
    );
    expect(handedOver.rows).toHaveLength(1);
  });

  it('confirms once after a restart between the authorization and its confirmation', async () => {
    const world = await mounted();
    const { offerId, reservation } = await reserved(world);
    world.paypal.approve(reservation.paypalOrderId);
    world.paypal.script('authorizeOrder', 'lose-answer');
    expect((await confirm(world, offerId)).status).toBe(202);
    world.restart();
    const again = await confirm(world, offerId);
    expect(again.status).toBe(200);
    expect(await orders(world)).toBe(1);
    expect(world.paypal.order(reservation.paypalOrderId)?.authorization?.status).toBe('CREATED');
  });

  it('charges once after a restart between the confirmation and the charge', async () => {
    const world = await mounted();
    const { order } = await confirmed(world);
    world.paypal.script('captureAuthorization', 'lose-answer');
    expect((await scan(world, order.pickup?.qr)).status).toBe(202);
    world.restart();
    world.clock.advance(60_000);
    await reconcile(world);
    const seen = orderViewSchema.parse(
      (await world.traveller.get(`/api/commerce/orders/${order.id}`)).body,
    );
    expect(seen.status).toBe('picked_up');
    expect(world.paypal.captures()).toBe(1);
    expect(calls(world, 'captureAuthorization')).toBe(1);
  });

  it('follows a pending refund to its end after a restart, and refunds once', async () => {
    const world = await mounted();
    const { order } = await confirmed(world);
    expect((await scan(world, order.pickup?.qr)).status).toBe(200);
    world.paypal.script('refundCapture', 'lose-request');
    const pending = await world.merchant.post(`/api/merchant/orders/${order.id}/refunds`, {
      lines: [0],
    });
    expect(pending.status).toBe(202);
    world.restart();
    world.clock.advance(5 * 60_000);
    await reconcile(world);
    const seen = orderViewSchema.parse(
      (await world.traveller.get(`/api/commerce/orders/${order.id}`)).body,
    );
    expect(seen.payment.refundPending.amountMinor).toBe(0);
    expect(seen.payment.refunded.amountMinor).toBe(
      z.object({ pending: z.object({ amountMinor: z.number() }) }).parse(pending.body).pending
        .amountMinor,
    );
    expect(world.paypal.refunds()).toBe(1);
  });
});
