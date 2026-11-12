import {
  paymentSchema,
  ticketCatalogSchema,
  ticketIntentSchema,
  ticketDemoPartnerSchema,
  ticketWalletSchema,
} from '@moviq/contracts';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Secret } from '../../src/config/secret.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../src/infrastructure/http/errors.js';
import {
  openMerchantSession,
  requireMerchant,
  type MerchantBindings,
} from '../../src/modules/commerce/merchant-sessions.js';
import { paymentsRoutes } from '../../src/modules/payments/routes.js';
import { ticketPurchases } from '../../src/modules/tickets/purchases.js';
import { ticketRoutes } from '../../src/modules/tickets/routes.js';
import { seedConfirmedSales } from './sales-fixture.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import type { TempDatabase } from '../support/temp-database.js';
import { availableSetup } from '../payments/support/api.js';
import { fakePayPal, type FakePayPal } from '../payments/support/fake-paypal.js';
import { paymentsDatabase } from '../payments/support/payments.js';

const clock = manualClock();
let temp: TempDatabase;
let db: Database;
let paypal: FakePayPal;
let app: Hono<AppBindings>;

function application(sandbox: boolean, demoEnabled = true) {
  const server = new Hono<AppBindings>();
  server.use(requestContext(memoryLogger().logger));
  const sessions = {
    db,
    clock,
    secureCookies: false,
    merchantAccessToken: new Secret('test-merchant-secret'),
  };
  server.post('/test/merchant-login', async (c) => {
    await openMerchantSession(c, sessions, 'demo-morningside-grind');
    return c.json({ ok: true });
  });
  const guarded = new Hono<MerchantBindings>();
  guarded.use(requireMerchant(sessions));
  guarded.get('/', (c) => c.json({ ok: true }));
  server.route('/test/merchant-private', guarded);
  server.route('/api/tickets', ticketRoutes({ ...sessions, sandbox, demoEnabled }));
  server.route(
    '/api/payments',
    paymentsRoutes({
      db,
      clock,
      secureCookies: false,
      catalog: ticketPurchases({ db, sandbox }),
      setup: availableSetup(paypal),
    }),
  );
  server.onError(unexpectedError);
  return server;
}
function device(server: Hono<AppBindings>) {
  let cookie = '';
  return async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await server.request(path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return { status: response.status, body: await response.json() };
  };
}
beforeEach(async () => {
  ({ temp, db } = await paymentsDatabase(clock));
  paypal = fakePayPal();
  app = application(true);
});
afterEach(async () => {
  await temp.dispose();
});

describe('ticket demonstrations', () => {
  it('charges the server price once and only shows a receipt to its owner after capture', async () => {
    const buyer = device(app);
    const other = device(app);
    const catalog = ticketCatalogSchema.parse((await buyer('GET', '/api/tickets/catalog')).body);
    expect(catalog.demo).toBe(true);
    expect(catalog.products.find((p) => p.id === 'path-tapp-40-demo')?.price.amountMinor).toBe(
      12400,
    );
    const intent = ticketIntentSchema.parse(
      (
        await buyer('POST', '/api/tickets/intents', {
          productId: 'omny-single-demo',
        })
      ).body,
    );
    expect(
      ticketWalletSchema.parse((await buyer('GET', '/api/tickets/wallet')).body).items,
    ).toHaveLength(0);
    expect((await other('POST', '/api/payments/orders', { purpose: intent.purpose })).status).toBe(
      409,
    );
    const start = await buyer('POST', '/api/payments/orders', {
      purpose: intent.purpose,
    });
    const payment = paymentSchema.parse(start.body);
    expect(payment.amount.amountMinor).toBe(300);
    expect(
      paymentSchema.parse(
        (
          await buyer('POST', '/api/payments/orders', {
            purpose: intent.purpose,
          })
        ).body,
      ).id,
    ).toBe(payment.id);
    expect((await buyer('POST', `/api/payments/orders/${payment.id}/confirm`)).status).toBe(409);
    expect(
      ticketWalletSchema.parse((await buyer('GET', '/api/tickets/wallet')).body).items,
    ).toHaveLength(0);
    clock.advance(120_000);
    const capturedAt = clock.now().toISOString();
    paypal.approve(payment.paypalOrderId);
    expect((await buyer('POST', `/api/payments/orders/${payment.id}/confirm`)).status).toBe(200);
    expect((await buyer('POST', `/api/payments/orders/${payment.id}/confirm`)).status).toBe(200);
    // The first capture was refused before approval; the retry completed and the next confirm made no call.
    expect(paypal.calls.filter((call) => call.method === 'captureOrder')).toHaveLength(2);
    expect(paypal.order(payment.paypalOrderId)?.capture?.status).toBe('COMPLETED');
    const receipt = ticketWalletSchema.parse((await buyer('GET', '/api/tickets/wallet')).body);
    expect(receipt.items).toHaveLength(1);
    expect((await buyer('POST', '/api/tickets/demo/traveller')).status).toBe(200);
    expect(
      ticketWalletSchema.parse((await buyer('GET', '/api/tickets/wallet')).body).items[0]
        ?.paymentId,
    ).toBe(payment.id);
    expect(receipt.items[0]?.createdAt).toBe(capturedAt);
    expect(
      ticketWalletSchema.parse((await other('GET', '/api/tickets/wallet')).body).items,
    ).toHaveLength(0);
    expect((await other('GET', `/api/payments/orders/${payment.id}`)).status).toBe(404);
    clock.advance(60_000);
    await db.execute({
      sql: "UPDATE payment_operations SET status = 'refunded' WHERE id = ?",
      args: [payment.id],
    });
    const refunded = ticketWalletSchema.parse((await buyer('GET', '/api/tickets/wallet')).body);
    expect(refunded.items[0]?.status).toBe('refunded');
    expect(refunded.items[0]?.createdAt).toBe(capturedAt);
    const nextIntent = ticketIntentSchema.parse(
      (
        await buyer('POST', '/api/tickets/intents', {
          productId: 'path-tapp-40-demo',
        })
      ).body,
    );
    const nextPayment = paymentSchema.parse(
      (
        await buyer('POST', '/api/payments/orders', {
          purpose: nextIntent.purpose,
        })
      ).body,
    );
    paypal.approve(nextPayment.paypalOrderId);
    expect((await buyer('POST', `/api/payments/orders/${nextPayment.id}/confirm`)).status).toBe(
      200,
    );
    expect((await app.request('/api/tickets/partner')).status).toBe(404);
    const partner = device(app);
    await partner('POST', '/test/merchant-login');
    expect((await partner('GET', '/api/tickets/demo/partner')).status).toBe(401);
    await partner('POST', '/api/tickets/demo/partner');
    expect((await partner('GET', '/test/merchant-private')).status).toBe(401);
    const summary = await partner('GET', '/api/tickets/demo/partner');
    expect(summary.status).toBe(200);
    const sales = ticketDemoPartnerSchema.parse(summary.body);
    expect(sales.items).toHaveLength(2);
    expect(sales.totals).toMatchObject({
      sales: 2,
      refunded: 1,
      amountMinor: 12700,
      refundedMinor: 300,
      netMinor: 12400,
      currency: 'USD',
    });
    expect(sales.items.find((item) => item.paymentId === payment.id)).toMatchObject({
      status: 'refunded',
      refundedMinor: 300,
      netMinor: 0,
    });
    expect(sales.items.find((item) => item.paymentId === nextPayment.id)).toMatchObject({
      amountMinor: 12400,
      netMinor: 12400,
    });
    expect(JSON.stringify(summary.body)).not.toContain('traveller');
    expect((await partner('POST', '/api/tickets/demo/logout')).status).toBe(200);
    expect((await partner('GET', '/api/tickets/demo/partner')).status).toBe(401);
  });
  it('bounds sales detail while totals include every confirmed sale', async () => {
    const buyer = device(app);
    await buyer('POST', '/api/tickets/intents', { productId: 'omny-single-demo' });
    await seedConfirmedSales(db, clock, 101);
    const partner = device(app);
    await partner('POST', '/api/tickets/demo/partner');
    const result = ticketDemoPartnerSchema.parse(
      (await partner('GET', '/api/tickets/demo/partner')).body,
    );
    expect(result.items).toHaveLength(100);
    expect(result.hasMore).toBe(true);
    expect(result.totals).toMatchObject({ sales: 101, amountMinor: 30300, netMinor: 30300 });
  });
  it('revokes the preceding partner session and expires the replacement', async () => {
    const first = await app.request('/api/tickets/demo/partner', { method: 'POST' });
    const firstCookie = first.headers.get('set-cookie')?.split(';')[0];
    if (firstCookie === undefined) throw new Error('No demo cookie');
    const second = await app.request('/api/tickets/demo/partner', {
      method: 'POST',
      headers: { cookie: firstCookie },
    });
    const secondCookie = second.headers.get('set-cookie')?.split(';')[0];
    if (secondCookie === undefined) throw new Error('No replacement cookie');
    expect(
      (await app.request('/api/tickets/demo/partner', { headers: { cookie: firstCookie } })).status,
    ).toBe(401);
    expect(
      (await app.request('/api/tickets/demo/partner', { headers: { cookie: secondCookie } }))
        .status,
    ).toBe(200);
    clock.advance(12 * 60 * 60_000);
    expect(
      (await app.request('/api/tickets/demo/partner', { headers: { cookie: secondCookie } }))
        .status,
    ).toBe(401);
  });
  it('requires explicit demo configuration and a sandbox', async () => {
    for (const server of [application(true, false), application(false, true)]) {
      const visitor = device(server);
      expect((await visitor('GET', '/api/tickets/demo/status')).body).toEqual({ enabled: false });
      expect((await visitor('POST', '/api/tickets/demo/traveller')).status).toBe(404);
      expect((await visitor('POST', '/api/tickets/demo/partner')).status).toBe(404);
      expect((await visitor('GET', '/api/tickets/demo/partner')).status).toBe(404);
    }
  });
  it('refuses intents and fulfilment outside the sandbox, and rejects client prices', async () => {
    const live = device(application(false));
    expect(
      (
        await live('POST', '/api/tickets/intents', {
          productId: 'omny-single-demo',
        })
      ).status,
    ).toBe(409);
    const buyer = device(app);
    expect(
      (
        await buyer('POST', '/api/tickets/intents', {
          productId: 'omny-single-demo',
          price: 1,
        })
      ).status,
    ).toBe(400);
    const intent = ticketIntentSchema.parse(
      (
        await buyer('POST', '/api/tickets/intents', {
          productId: 'omny-single-demo',
        })
      ).body,
    );
    const buyerId = (await db.query('SELECT traveller_id FROM ticket_intents')).rows[0]?.[
      'traveller_id'
    ];
    if (typeof buyerId !== 'string') throw new Error('No traveller');
    expect(
      await ticketPurchases({ db, sandbox: false }).quote(intent.purpose, buyerId),
    ).toMatchObject({ ok: false });
    await expect(
      db.transaction((tx) =>
        ticketPurchases({ db, sandbox: false }).fulfil(intent.purpose, 'fake', tx),
      ),
    ).rejects.toThrow(/sandbox/);
    expect(paypal.calls).toHaveLength(0);
  });
});
