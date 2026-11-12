import {
  agentSetupSchema,
  needViewSchema,
  orderViewSchema,
  reservationSchema,
  type OrderView,
  type WeeklyHours,
} from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import type { Database } from '../../src/infrastructure/database/database.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';
import { fakeHoldPayPal, type FakeHoldPayPal } from '../payments/support/fake-paypal-holds.js';
import {
  paypalHoldsServer,
  type PayPalHoldsServer,
} from '../payments/support/paypal-holds-server.js';
import { needRequest } from './support/commerce.js';
import {
  freePort,
  killAll,
  portBrowser,
  startProcess,
  waitFor,
  type ServerProcess,
} from './support/processes.js';

/**
 * The API and the worker as real processes over one SQLite file, stopped by a signal and started
 * again between the steps of a payment. PayPal is the in-memory PayPal of holds behind a local
 * port (`TEST_PROVIDER_ORIGIN`): no network, and its state outlives the processes, as PayPal's
 * would. The pickup codes are signed with one `ORDER_CODE_SECRET` across restarts.
 */

/** The worker looks at what PayPal left in doubt every 15 s, the first time 30 s to 1 min on. */
const SETTLED_WITHIN_MS = 150_000;
const CASE_MS = 240_000;
const ALL_DAY: WeeklyHours = {
  mon: [{ opens: '00:00', closes: '24:00' }],
  tue: [{ opens: '00:00', closes: '24:00' }],
  wed: [{ opens: '00:00', closes: '24:00' }],
  thu: [{ opens: '00:00', closes: '24:00' }],
  fri: [{ opens: '00:00', closes: '24:00' }],
  sat: [{ opens: '00:00', closes: '24:00' }],
  sun: [{ opens: '00:00', closes: '24:00' }],
};

let temp: TempDatabase;
let db: Database;
let paypal: FakeHoldPayPal;
let provider: PayPalHoldsServer;
let env: Record<string, string>;
let origin: string;
let api: ServerProcess | undefined;
let worker: ServerProcess | undefined;

beforeEach(async () => {
  temp = await tempDatabase();
  paypal = fakeHoldPayPal();
  provider = await paypalHoldsServer(paypal);
  const port = await freePort();
  origin = `http://127.0.0.1:${String(port)}`;
  env = {
    APP_ENV: 'test',
    MERCHANT_ACCESS_TOKEN: MERCHANT_TEST_TOKEN,
    PORT: String(port),
    DATABASE_URL: temp.url,
    TEST_PROVIDER_ORIGIN: provider.origin,
    PAYPAL_ENV: 'sandbox',
    PAYPAL_CLIENT_ID: 'client-id-for-tests',
    PAYPAL_CLIENT_SECRET: 'client-secret-for-tests',
    ORDER_CODE_SECRET: 'a-stable-pickup-code-secret-for-these-restarts',
    WORKER_LEASE_TTL_SECONDS: '3',
    WORKER_HEARTBEAT_SECONDS: '1',
  };
  await start();
  db = await temp.open();
});

afterEach(async () => {
  killAll();
  await provider.close();
  await temp.dispose();
});

/** Both processes, each ready: the API listening, the worker holding the lease. */
async function start(): Promise<void> {
  const nextApi = startProcess('main', env);
  const nextWorker = startProcess('worker', env);
  await waitFor('api listening', () => nextApi.output().includes('"msg":"listening"'), 30_000);
  await waitFor('worker leader', () => nextWorker.output().includes('lease acquired'), 30_000);
  api = nextApi;
  worker = nextWorker;
}

/** Stops both by a signal, as a deploy or a crash does, and starts them again. */
async function restart(apiSignal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
  await Promise.all([api?.stop(apiSignal), worker?.stop('SIGTERM')]);
  await start();
}

const count = async (sql: string) =>
  z.object({ n: z.number() }).parse({ ...(await db.query(sql)).rows[0] }).n;
const orders = () => count('SELECT COUNT(*) AS n FROM commerce_orders');
const handedOver = () =>
  count("SELECT COUNT(*) AS n FROM commerce_orders WHERE status = 'picked_up'");
const calls = (method: string) => paypal.calls.filter((call) => call.method === method);

/** The ramen merchant open all day, so the test runs at any hour; then a need and its offer. */
async function reserved() {
  const merchant = portBrowser(origin);
  await merchant.post('/api/merchant/session', {
    token: MERCHANT_TEST_TOKEN,
    merchantId: 'demo-tsuki-ramen-house',
  });
  const agent = agentSetupSchema.parse((await merchant.get('/api/merchant/agent')).body);
  const saved = await merchant.put('/api/merchant/agent', {
    rules: agent.rules,
    version: agent.version,
    hours: ALL_DAY,
  });
  expect(saved.status).toBe(200);
  const traveller = portBrowser(origin);
  const base = needRequest();
  const at = new Date(Date.now() + 30 * 60_000).toISOString();
  const need = needViewSchema.parse(
    (await traveller.post('/api/commerce/needs', { ...base, route: { ...base.route, at } })).body,
  );
  const offerId = need.offers[0]?.id ?? '';
  expect(offerId).not.toBe('');
  const reservation = reservationSchema.parse(
    (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
  );
  return { merchant, traveller, offerId, orderId: reservation.paypalOrderId };
}

async function confirmed() {
  const flow = await reserved();
  paypal.approve(flow.orderId);
  const answer = await flow.traveller.post(`/api/commerce/offers/${flow.offerId}/confirm`);
  expect(answer.status).toBe(200);
  return { ...flow, order: orderViewSchema.parse(answer.body) };
}

async function orderSeen(
  traveller: ReturnType<typeof portBrowser>,
  id: string,
): Promise<OrderView> {
  return orderViewSchema.parse((await traveller.get(`/api/commerce/orders/${id}`)).body);
}

describe('real processes stopped and started again between the steps of a payment (V02)', () => {
  it(
    'authorized in PayPal, its answer lost, then restarted: the worker creates the one order',
    async () => {
      const flow = await reserved();
      paypal.approve(flow.orderId);
      paypal.script('authorizeOrder', 'lose-answer');
      const first = await flow.traveller.post(`/api/commerce/offers/${flow.offerId}/confirm`);
      expect(first.status).toBe(202);
      expect(await orders()).toBe(0);
      await restart('SIGTERM');
      await waitFor(
        'order created by the worker',
        async () => (await orders()) === 1,
        SETTLED_WITHIN_MS,
      );
      const again = await flow.traveller.post(`/api/commerce/offers/${flow.offerId}/confirm`);
      expect(again.status).toBe(200);
      expect(await orders()).toBe(1);
      expect(new Set(calls('authorizeOrder').map((call) => call.requestId)).size).toBe(1);
      expect(paypal.order(flow.orderId)?.authorization?.status).toBe('CREATED');
      expect(paypal.captures()).toBe(0);
    },
    CASE_MS,
  );

  it(
    'confirmed, then crashed: the code shown before still charges once, and the worker hands over',
    async () => {
      const flow = await confirmed();
      await restart('SIGKILL');
      paypal.script('captureAuthorization', 'lose-answer');
      const scan = () => flow.merchant.post('/api/merchant/scan', { code: flow.order.pickup?.qr });
      expect((await scan()).status).toBe(202);
      await restart('SIGTERM');
      await waitFor(
        'order handed over by the worker',
        async () => (await orderSeen(flow.traveller, flow.order.id)).status === 'picked_up',
        SETTLED_WITHIN_MS,
      );
      expect((await scan()).status).toBe(409);
      expect(paypal.captures()).toBe(1);
      expect(calls('captureAuthorization')).toHaveLength(1);
      expect(await orders()).toBe(1);
      expect(await handedOver()).toBe(1);
    },
    CASE_MS,
  );

  it(
    'a refund whose request was lost, then restarted: the worker refunds it once',
    async () => {
      const flow = await confirmed();
      expect(
        (await flow.merchant.post('/api/merchant/scan', { code: flow.order.pickup?.qr })).status,
      ).toBe(200);
      paypal.script('refundCapture', 'lose-request');
      const refund = () =>
        flow.merchant.post(`/api/merchant/orders/${flow.order.id}/refunds`, { lines: [0] });
      const pending = await refund();
      expect(pending.status).toBe(202);
      const owed = z
        .object({ pending: z.object({ amountMinor: z.number().positive() }) })
        .parse(pending.body).pending.amountMinor;
      await restart('SIGTERM');
      await waitFor(
        'refund confirmed by the worker',
        async () =>
          (await orderSeen(flow.traveller, flow.order.id)).payment.refundPending.amountMinor === 0,
        SETTLED_WITHIN_MS,
      );
      const seen = await orderSeen(flow.traveller, flow.order.id);
      expect(seen.payment.refunded.amountMinor).toBe(owed);
      // Asked again after it settled: already refunded, nothing more is asked of PayPal.
      expect((await refund()).status).toBe(409);
      expect(paypal.refunds()).toBe(1);
      expect(paypal.captures()).toBe(1);
      expect(await orders()).toBe(1);
      expect(await handedOver()).toBe(1);
    },
    CASE_MS,
  );

  it(
    'without ORDER_CODE_SECRET a new process has a new key: the old code charges nothing',
    async () => {
      await Promise.all([api?.stop('SIGTERM'), worker?.stop('SIGTERM')]);
      env = Object.fromEntries(
        Object.entries(env).filter(([name]) => name !== 'ORDER_CODE_SECRET'),
      );
      await start();
      const flow = await confirmed();
      await restart('SIGTERM');
      const scan = await flow.merchant.post('/api/merchant/scan', { code: flow.order.pickup?.qr });
      expect(scan).toMatchObject({ status: 409, body: { error: { reason: 'not-moviq' } } });
      expect(calls('captureAuthorization')).toHaveLength(0);
      expect(paypal.captures()).toBe(0);
    },
    CASE_MS,
  );
});
