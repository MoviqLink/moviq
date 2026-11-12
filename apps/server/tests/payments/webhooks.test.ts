import { paymentSchema, type Payment } from '@moviq/contracts';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import type { AppBindings } from '../../src/infrastructure/http/context.js';
import { parseRow } from '../../src/infrastructure/database/rows.js';
import { manualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { availableSetup, device, paymentsApp } from './support/api.js';
import { fakePayPal, lostAnswer, type FakePayPal } from './support/fake-paypal.js';
import { fixture } from './support/fixtures.js';
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
let app: Hono<AppBindings>;
let catalog: TestCatalog;

beforeEach(async () => {
  ({ temp, db } = await paymentsDatabase(clock));
  paypal = fakePayPal();
  catalog = testCatalog();
  app = paymentsApp({ db, clock, catalog, setup: availableSetup(paypal) });
});

afterEach(async () => {
  await temp.dispose();
});

/** The signed delivery of the official verify-webhook-signature example. */
const example = z
  .object({
    transmission_id: z.string(),
    transmission_time: z.string(),
    cert_url: z.string(),
    auth_algo: z.string(),
    transmission_sig: z.string(),
    webhook_event: z.object({ id: z.string(), create_time: z.string() }),
  })
  .parse(fixture('verify-webhook-signature-request.json'));

const signed = {
  'paypal-auth-algo': example.auth_algo,
  'paypal-cert-url': example.cert_url,
  'paypal-transmission-id': example.transmission_id,
  'paypal-transmission-sig': example.transmission_sig,
  'paypal-transmission-time': example.transmission_time,
};

/**
 * A v2 event in the envelope of the official example (its id and time), about one of our
 * orders. The reference has no v2 event example; the envelope fields are the same.
 */
const approvedEvent = (orderId: string, id = example.webhook_event.id) => ({
  id,
  create_time: example.webhook_event.create_time,
  resource_type: 'checkout-order',
  event_type: 'CHECKOUT.ORDER.APPROVED',
  summary: 'An order has been approved by buyer',
  resource: { id: orderId, status: 'APPROVED' },
});

const deliver = (event: unknown, headers: Record<string, string> = signed) =>
  app.request('/api/payments/webhooks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(event),
  });

async function approvedPayment(): Promise<Payment> {
  const response = await device(app).post('/orders', { purpose: alternative() });
  const payment = paymentSchema.parse(response.body);
  paypal.approve(payment.paypalOrderId);
  return payment;
}

const eventRow = z.object({
  processed_at: z.string().nullable(),
  last_error: z.string().nullable(),
});
const storedEvent = async () =>
  parseRow(
    eventRow,
    (await db.query('SELECT processed_at, last_error FROM provider_events')).rows[0],
    'provider_events',
  );

describe('POST /api/payments/webhooks', () => {
  it('refuses unsigned deliveries and signatures PayPal does not confirm, and records nothing', async () => {
    const payment = await approvedPayment();
    expect((await deliver(approvedEvent(payment.paypalOrderId), {})).status).toBe(400);
    paypal.signatureValid = false;
    expect((await deliver(approvedEvent(payment.paypalOrderId))).status).toBe(400);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM provider_events')).toBe(0);
    expect(paypal.calls.filter((call) => call.method === 'getOrder')).toHaveLength(0);
  });

  it('settles the payment from the order read back, once per event', async () => {
    // The buyer approved and closed the window: the notification completes the purchase.
    const payment = await approvedPayment();
    const first = await deliver(approvedEvent(payment.paypalOrderId));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ result: 'processed' });
    expect((await storedStatus(db, payment.id)).status).toBe('captured');
    expect(await fulfilments(db)).toBe(1);
    const reads = paypal.calls.length;
    const again = await deliver(approvedEvent(payment.paypalOrderId));
    expect(await again.json()).toEqual({ result: 'duplicate' });
    expect(paypal.calls.length).toBe(reads + 1);
    expect(paypal.calls.at(-1)?.method).toBe('verifyWebhookSignature');
  });

  it('a failed event stays unprocessed: the retry runs it, the next is a duplicate (NF-PAY-09)', async () => {
    const payment = await approvedPayment();
    paypal.script('getOrder', { fail: lostAnswer('orders.get') });
    const failed = await deliver(approvedEvent(payment.paypalOrderId));
    expect(failed.status).toBe(500);
    expect(await storedEvent()).toMatchObject({
      processed_at: null,
      last_error: expect.any(String) as unknown,
    });
    const retried = await deliver(approvedEvent(payment.paypalOrderId));
    expect(await retried.json()).toEqual({ result: 'processed' });
    expect(await fulfilments(db)).toBe(1);
    expect(await (await deliver(approvedEvent(payment.paypalOrderId))).json()).toEqual({
      result: 'duplicate',
    });
  });

  it('an approval that arrives after the payment closed captures nothing', async () => {
    const traveller = device(app);
    const payment = paymentSchema.parse(
      (await traveller.post('/orders', { purpose: alternative() })).body,
    );
    // The price changes and a new order replaces this one; then the old one is approved.
    catalog.prices.set('taxi-1', {
      amount: { amountMinor: 2390, currency: 'USD' },
      description: 'Taxi to JFK',
    });
    await traveller.post('/orders', { purpose: alternative() });
    paypal.approve(payment.paypalOrderId);
    expect(await (await deliver(approvedEvent(payment.paypalOrderId))).json()).toEqual({
      result: 'processed',
    });
    expect((await storedStatus(db, payment.id)).status).toBe('failed');
    expect(paypal.calls.filter((call) => call.method === 'captureOrder')).toHaveLength(0);
  });

  it('an event about an order MovIQ never opened is acknowledged and left alone', async () => {
    const response = await deliver(approvedEvent('5O190127TN364715T', 'WH-OTHER'));
    expect(await response.json()).toEqual({ result: 'unmatched' });
    expect((await storedEvent()).processed_at).not.toBeNull();
  });

  it('a refund made in PayPal is recorded once and closes the payment', async () => {
    const payment = await approvedPayment();
    await device(app).post('/orders', { purpose: alternative() });
    await deliver(approvedEvent(payment.paypalOrderId));
    const captureId = paypal.order(payment.paypalOrderId)?.capture?.id ?? '';
    const refund = await paypal.refundCapture(captureId, { requestId: 'dashboard-refund' });
    const refunded = {
      id: 'WH-REFUND',
      create_time: example.webhook_event.create_time,
      resource_type: 'refund',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: refund.id,
        links: [
          { href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}`, rel: 'up' },
        ],
      },
    };
    expect(await (await deliver(refunded)).json()).toEqual({ result: 'processed' });
    expect((await deliver({ ...refunded, id: 'WH-REFUND-2' })).status).toBe(200);
    expect((await storedStatus(db, payment.id)).status).toBe('refunded');
    expect(await count(db, 'SELECT SUM(amount_minor) AS n FROM payment_refunds')).toBe(2140);
  });

  it('is not served while PAYPAL_WEBHOOK_ID is not set', async () => {
    app = paymentsApp({
      db,
      clock,
      catalog: testCatalog(),
      setup: availableSetup(paypal, { webhooks: false }),
    });
    expect((await deliver(approvedEvent('ORDER1'))).status).toBe(404);
  });
});
