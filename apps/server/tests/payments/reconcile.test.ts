import { paymentSchema, type Payment } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import { LeaseLostError, type LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import { reconcilePayments } from '../../src/modules/payments/reconcile.js';
import { startRunner } from '../support/leadership.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import type { TempDatabase } from '../support/temp-database.js';
import { waitFor } from '../support/wait.js';
import { availableSetup, device, paymentsApp } from './support/api.js';
import { fakePayPal, refusal, type FakePayPal } from './support/fake-paypal.js';
import {
  alternative,
  fulfilments,
  paymentsDatabase,
  storedStatus,
  testCatalog,
  type TestCatalog,
} from './support/payments.js';

let clock: ManualClock;
let temp: TempDatabase;
let db: Database;
let paypal: FakePayPal;
let catalog: TestCatalog;

beforeEach(async () => {
  clock = manualClock();
  ({ temp, db } = await paymentsDatabase(clock));
  paypal = fakePayPal();
  catalog = testCatalog();
});

afterEach(async () => {
  await temp.dispose();
});

const MINUTE = 60_000;
const calls = (method: string) => paypal.calls.filter((call) => call.method === method);

/** A traveller's device on the API process. */
const api = () => device(paymentsApp({ db, clock, catalog, setup: availableSetup(paypal) }));

async function startPayment(alternativeId = 'taxi-1'): Promise<Payment> {
  const response = await api().post('/orders', { purpose: alternative(alternativeId) });
  return paymentSchema.parse(response.body);
}

/** The worker, as another process on its own connection, reconciling while it holds the lease. */
async function runWorkerUntil(check: () => boolean | Promise<boolean>): Promise<void> {
  const worker = await temp.open();
  const runner = startRunner(worker, {
    holder: 'worker-after-restart',
    clock,
    work: (term) =>
      reconcilePayments(term, {
        db: worker,
        clock,
        logger: memoryLogger().logger,
        catalog,
        setup: availableSetup(paypal),
        intervalMs: 10,
      }),
  });
  try {
    await waitFor(check);
  } finally {
    await runner.stop();
  }
}

describe('payment reconciliation', () => {
  it('recovers a capture PayPal made before the process could record it, once (NF-PAY-05)', async () => {
    const traveller = api();
    const payment = paymentSchema.parse(
      (await traveller.post('/orders', { purpose: alternative() })).body,
    );
    paypal.approve(payment.paypalOrderId);
    // PayPal captures, then the answer never arrives: the process stops before recording it.
    paypal.script('captureOrder', { loseAnswer: true });
    await traveller.post(`/orders/${payment.id}/confirm`);
    expect(await storedStatus(db, payment.id)).toEqual({ status: 'unknown', pending: 'capture' });
    clock.advance(MINUTE);
    await runWorkerUntil(async () => (await storedStatus(db, payment.id)).status === 'captured');
    expect(await fulfilments(db)).toBe(1);
    expect(calls('captureOrder')).toHaveLength(1);
  });

  it('captures an order its buyer approved but never confirmed, at the price still offered', async () => {
    const payment = await startPayment();
    paypal.approve(payment.paypalOrderId);
    clock.advance(16 * MINUTE);
    await runWorkerUntil(async () => (await storedStatus(db, payment.id)).status === 'captured');
    expect(await fulfilments(db)).toBe(1);
    expect(catalog.quotes).toBe(2);
  });

  it('closes an order PayPal no longer has: it lapsed and nothing was charged', async () => {
    const payment = await startPayment();
    paypal.script('getOrder', { fail: refusal('orders.get', 404, 'RESOURCE_NOT_FOUND') });
    clock.advance(16 * MINUTE);
    await runWorkerUntil(async () => (await storedStatus(db, payment.id)).status === 'failed');
    expect(calls('captureOrder')).toHaveLength(0);
  });

  it('opens the order of a payment whose creation went unanswered, reusing its request id', async () => {
    paypal.script('createOrder', { loseAnswer: true });
    const response = await api().post('/orders', { purpose: alternative() });
    expect(response.status).toBe(500);
    clock.advance(3 * MINUTE);
    await runWorkerUntil(
      () => paypal.calls.filter((call) => call.method === 'createOrder').length === 2,
    );
    const [first, second] = calls('createOrder');
    expect(second?.requestId).toBe(first?.requestId);
    expect(paypal.order('ORDER1')).toBeDefined();
    expect(paypal.order('ORDER2')).toBeUndefined();
  });

  it('one payment that fails does not hold up the others', async () => {
    catalog.prices.set('boom', {
      amount: { amountMinor: 900, currency: 'USD' },
      description: 'Taxi',
    });
    const broken = await startPayment('boom');
    const healthy = await startPayment('taxi-1');
    paypal.approve(broken.paypalOrderId);
    paypal.approve(healthy.paypalOrderId);
    const quote = catalog.quote.bind(catalog);
    catalog.quote = (purpose, travellerId) =>
      purpose.kind === 'journey-alternative' && purpose.alternativeId === 'boom'
        ? Promise.reject(new Error('catalogue down'))
        : quote(purpose, travellerId);
    clock.advance(16 * MINUTE);
    await runWorkerUntil(async () => (await storedStatus(db, healthy.id)).status === 'captured');
    expect((await storedStatus(db, broken.id)).status).toBe('approved');
  });

  it('writes nothing once the lease is lost', async () => {
    const payment = await startPayment();
    paypal.approve(payment.paypalOrderId);
    clock.advance(16 * MINUTE);
    const controller = new AbortController();
    const lost: LeaderTerm = {
      name: 'worker',
      holder: 'stale-worker',
      fencingToken: 1,
      signal: controller.signal,
      fenced: () => Promise.reject(new LeaseLostError('worker')),
    };
    await expect(
      reconcilePayments(lost, {
        db,
        clock,
        logger: memoryLogger().logger,
        catalog,
        setup: availableSetup(paypal),
        intervalMs: 10,
      }),
    ).rejects.toThrow(LeaseLostError);
    expect(await storedStatus(db, payment.id)).toEqual({ status: 'created', pending: null });
    expect(calls('captureOrder')).toHaveLength(0);
  });

  it('without PayPal set up, does nothing and says why', async () => {
    const log = memoryLogger();
    const term: LeaderTerm = {
      name: 'worker',
      holder: 'w',
      fencingToken: 1,
      signal: new AbortController().signal,
      fenced: (work) => db.transaction(work),
    };
    await reconcilePayments(term, {
      db,
      clock,
      logger: log.logger,
      catalog,
      setup: { available: false, reason: 'PayPal is not available right now.' },
      intervalMs: 10,
    });
    expect(log.text()).toContain('payment reconciliation is off');
  });
});
