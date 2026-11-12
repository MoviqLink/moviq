import {
  apiErrorSchema,
  paymentSchema,
  paymentsConfigSchema,
  type Payment,
} from '@moviq/contracts';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveIntegrations } from '../../src/config/integrations.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import type { AppBindings } from '../../src/infrastructure/http/context.js';
import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import { paymentsSetup } from '../../src/modules/payments/setup.js';
import { manualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { availableSetup, CLIENT_ID, device, paymentsApp } from './support/api.js';
import { fakePayPal, refusal, type FakePayPal } from './support/fake-paypal.js';
import {
  alternative,
  count,
  fulfilments,
  paymentsDatabase,
  storedStatus,
  testCatalog,
  type TestCatalog,
} from './support/payments.js';

const clock = manualClock();
let temp: TempDatabase;
let db: Database;
let paypal: FakePayPal;
let catalog: TestCatalog;
let app: Hono<AppBindings>;

beforeEach(async () => {
  ({ temp, db } = await paymentsDatabase(clock));
  paypal = fakePayPal();
  catalog = testCatalog();
  app = paymentsApp({ db, clock, catalog, setup: availableSetup(paypal) });
});

afterEach(async () => {
  await temp.dispose();
});

const order = { purpose: alternative() };
const calls = (method: string) => paypal.calls.filter((call) => call.method === method);
const errorMessage = (body: unknown) => apiErrorSchema.parse(body).error.message;

async function start(
  traveller = device(app),
): Promise<{ payment: Payment; traveller: ReturnType<typeof device> }> {
  const response = await traveller.post('/orders', order);
  expect(response.status).toBe(200);
  return { payment: paymentSchema.parse(response.body), traveller };
}

describe('GET /api/payments/config', () => {
  it('gives the PayPal button its public client id, environment and currency', async () => {
    const response = await device(app).get('/config');
    expect(paymentsConfigSchema.parse(response.body)).toEqual({
      available: true,
      clientId: CLIENT_ID,
      environment: 'sandbox',
      currency: 'USD',
    });
  });

  it('without keys, says payments are unavailable and why, and takes none', async () => {
    const setup = paymentsSetup({
      config: { integrations: resolveIntegrations({}), paypalEnv: 'sandbox' },
      http: createHttpClient(),
      clock,
    });
    const offline = paymentsApp({ db, clock, catalog, setup });
    const config = paymentsConfigSchema.parse((await device(offline).get('/config')).body);
    expect(config).toEqual({
      available: false,
      reason: expect.stringContaining('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET') as unknown,
    });
    const attempt = await device(offline).post('/orders', order);
    expect(attempt.status).toBe(409);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM travellers')).toBe(0);
  });
});

describe('POST /api/payments/orders', () => {
  it('prices the purchase on the server and opens one PayPal order with an opaque reference', async () => {
    const { payment } = await start();
    expect(payment).toMatchObject({
      status: 'created',
      amount: { amountMinor: 2140, currency: 'USD' },
      description: 'Taxi to JFK',
      paypalOrderId: 'ORDER1',
      purpose: alternative(),
    });
    const [created] = calls('createOrder');
    expect(created).toEqual({
      method: 'createOrder',
      target: payment.id,
      requestId: `${payment.id}:create`,
    });
    // NF-SEC-07: what PayPal receives names neither the journey nor the traveller.
    const sent = JSON.stringify(paypal.order('ORDER1')?.input);
    const traveller = await db.query('SELECT id FROM travellers');
    const travellerId = z.object({ id: z.string() }).parse(traveller.rows[0]).id;
    for (const internal of ['journey-1', 'taxi-1', travellerId]) {
      expect(sent).not.toContain(internal);
    }
  });

  it('refuses an amount sent by the client, without calling PayPal (NF-PAY-12)', async () => {
    const response = await device(app).post('/orders', {
      ...order,
      amount: { amountMinor: 1, currency: 'USD' },
    });
    expect(response.status).toBe(400);
    expect(paypal.calls).toEqual([]);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM payment_operations')).toBe(0);
  });

  it('refuses a purchase the catalogue no longer offers, without calling PayPal', async () => {
    const response = await device(app).post('/orders', { purpose: alternative('gone') });
    expect(response.status).toBe(409);
    expect(errorMessage(response.body)).toBe('This option is no longer on offer.');
    expect(paypal.calls).toEqual([]);
  });

  it('a repeated request finds the open payment: one purchase, one PayPal order', async () => {
    const { payment, traveller } = await start();
    const again = await traveller.post('/orders', order);
    expect(paymentSchema.parse(again.body).id).toBe(payment.id);
    expect(calls('createOrder')).toHaveLength(1);
  });

  it('a new price replaces an order nobody paid', async () => {
    const { payment, traveller } = await start();
    catalog.prices.set('taxi-1', {
      amount: { amountMinor: 2390, currency: 'USD' },
      description: 'Taxi to JFK',
    });
    const repriced = paymentSchema.parse((await traveller.post('/orders', order)).body);
    expect(repriced.id).not.toBe(payment.id);
    expect(repriced.amount.amountMinor).toBe(2390);
    expect((await storedStatus(db, payment.id)).status).toBe('failed');
  });

  it('when PayPal does not answer, nothing is shown as paid and a retry recovers the same order', async () => {
    paypal.script('createOrder', { loseAnswer: true });
    const traveller = device(app);
    const lost = await traveller.post('/orders', order);
    expect(lost.status).toBe(500);
    expect(errorMessage(lost.body)).toMatch(/Nothing has been charged/);
    const { payment } = await start(traveller);
    expect(payment.paypalOrderId).toBe('ORDER1');
    expect(calls('createOrder').map((call) => call.requestId)).toEqual([
      `${payment.id}:create`,
      `${payment.id}:create`,
    ]);
  });
});

describe('POST /api/payments/orders/:id/confirm', () => {
  it('before the buyer approves, charges nothing and says so', async () => {
    const { payment, traveller } = await start();
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(409);
    expect(errorMessage(response.body)).toMatch(/Approve the payment/);
    expect((await storedStatus(db, payment.id)).status).toBe('created');
    expect(await fulfilments(db)).toBe(0);
  });

  it('captures once and applies once, however often it is called (NF-PAY-03)', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    const [first, second] = await Promise.all([
      traveller.post(`/orders/${payment.id}/confirm`),
      traveller.post(`/orders/${payment.id}/confirm`),
    ]);
    const third = await traveller.post(`/orders/${payment.id}/confirm`);
    for (const response of [first, second, third]) {
      expect(response.status).toBe(200);
      expect(paymentSchema.parse(response.body).status).toBe('captured');
    }
    expect(await fulfilments(db)).toBe(1);
    expect(paypal.order('ORDER1')?.capture?.status).toBe('COMPLETED');
    expect(new Set(calls('captureOrder').map((call) => call.requestId))).toEqual(
      new Set([`${payment.id}:capture`]),
    );
  });

  it('belongs to its traveller: another device gets a 404', async () => {
    const { payment } = await start();
    paypal.approve('ORDER1');
    const stranger = device(app);
    await stranger.post('/orders', { purpose: alternative('taxi-1') });
    expect((await stranger.get(`/orders/${payment.id}`)).status).toBe(404);
    expect((await stranger.post(`/orders/${payment.id}/confirm`)).status).toBe(404);
    expect((await device(app).get(`/orders/${payment.id}`)).status).toBe(404);
    expect(calls('captureOrder')).toHaveLength(0);
  });

  it('a capture whose answer is lost stays unknown, and is read back instead of charged again', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    paypal.script('captureOrder', { loseAnswer: true });
    const lost = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(lost.status).toBe(202);
    expect(paymentSchema.parse(lost.body).status).toBe('unknown');
    expect(await fulfilments(db)).toBe(0);
    const settled = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(paymentSchema.parse(settled.body).status).toBe('captured');
    expect(calls('captureOrder')).toHaveLength(1);
    expect(calls('getOrder')).toHaveLength(1);
    expect(await fulfilments(db)).toBe(1);
  });

  it('a declined payment method charges nothing and lets the buyer choose another', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    paypal.script('captureOrder', { fail: refusal('orders.capture', 422, 'INSTRUMENT_DECLINED') });
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(409);
    expect(errorMessage(response.body)).toMatch(/Choose another one in PayPal/);
    expect((await storedStatus(db, payment.id)).status).toBe('created');
  });

  it('a capture PayPal refuses as already made is read back and recorded, not repeated', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    // Captured under another request id, as a retry after PayPal's 6-hour key window would be.
    await paypal.captureOrder('ORDER1', 'earlier-attempt');
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(paymentSchema.parse(response.body).status).toBe('captured');
    expect(await fulfilments(db)).toBe(1);
    expect(calls('captureOrder')).toHaveLength(2);
  });

  it('a refused capture counts as failed only once PayPal shows no capture', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    paypal.script('captureOrder', { fail: refusal('orders.capture', 422, 'TRANSACTION_REFUSED') });
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(409);
    expect(errorMessage(response.body)).toBe(
      'PayPal could not take this payment. Nothing has been charged.',
    );
    expect(calls('getOrder')).toHaveLength(1);
    expect((await storedStatus(db, payment.id)).status).toBe('failed');
  });

  it('a purchase that cannot be applied after payment is refunded in full, once', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    catalog.fulfilError = new Error('The journey has already ended.');
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(409);
    expect(errorMessage(response.body)).toBe('This payment was refunded in full.');
    expect(paymentSchema.parse((await traveller.get(`/orders/${payment.id}`)).body).status).toBe(
      'refunded',
    );
    expect(await fulfilments(db)).toBe(0);
    expect(await count(db, 'SELECT SUM(amount_minor) AS n FROM payment_refunds')).toBe(2140);
    expect(calls('refundCapture').map((call) => call.requestId)).toEqual([
      `${payment.id}:refund:unapplied`,
    ]);
    await traveller.post(`/orders/${payment.id}/confirm`);
    expect(calls('refundCapture')).toHaveLength(1);
  });

  it('a price that changed after the order opened is not charged', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    catalog.prices.set('taxi-1', {
      amount: { amountMinor: 3000, currency: 'USD' },
      description: 'Taxi to JFK',
    });
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(409);
    expect((await storedStatus(db, payment.id)).status).toBe('failed');
    expect(calls('captureOrder')).toHaveLength(0);
  });

  it('PayPal turning the capture away charges nothing and leaves the payment as it was', async () => {
    const { payment, traveller } = await start();
    paypal.approve('ORDER1');
    paypal.script('captureOrder', {
      fail: new PayPalError('orders.capture', 'not_done', 'HTTP 429', { status: 429 }),
    });
    const response = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(response.status).toBe(500);
    expect(errorMessage(response.body)).toMatch(/Nothing has been charged/);
    expect((await storedStatus(db, payment.id)).status).toBe('created');
    const retried = await traveller.post(`/orders/${payment.id}/confirm`);
    expect(paymentSchema.parse(retried.body).status).toBe('captured');
    expect(await fulfilments(db)).toBe(1);
  });
});
