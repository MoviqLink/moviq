import {
  kitchenTicketSchema,
  merchantRequestSchema,
  merchantTodaySchema,
  needViewSchema,
  orderViewSchema,
  payoutViewSchema,
  reservationSchema,
} from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';
import { collectedOrder, fakePayouts, merchantSession } from './support/orders.js';

let world: CommerceWorld | undefined;

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

const sessionSchema = z.object({ signedIn: z.boolean() });

describe("the merchant's panel", () => {
  it('opens a demo session with an HttpOnly cookie, and closes it', async () => {
    world = await commerceWorld();
    const merchant = browser(world.app);
    const response = await world.app.request('/api/merchant/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchantId: 'demo-tsuki-ramen-house', token: MERCHANT_TEST_TOKEN }),
    });
    expect(response.headers.get('set-cookie')).toMatch(/moviq_merchant=.*HttpOnly/i);
    await merchant.post('/api/merchant/session', {
      token: MERCHANT_TEST_TOKEN,
      merchantId: 'demo-tsuki-ramen-house',
    });
    expect(sessionSchema.parse((await merchant.get('/api/merchant/session')).body).signedIn).toBe(
      true,
    );
    await merchant.delete('/api/merchant/session');
    expect(sessionSchema.parse((await merchant.get('/api/merchant/session')).body).signedIn).toBe(
      false,
    );
  });

  it('refuses the panel without a session and never lets a demo merchant change its payout account', async () => {
    world = await commerceWorld();
    expect(
      (await browser(world.app).put('/api/merchant/agent', { rules: {}, version: 1 })).status,
    ).toBe(401);
    const merchant = await merchantSession(world);
    expect(
      (await merchant.put('/api/merchant/payout-account', { receiver: 'me@example.com' })).status,
    ).toBe(403);
  });

  it("applies the agent's new maximum discount to the next offers, never below the program minimum", async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const agent = z
      .object({
        rules: z.looseObject({ maxDiscountPercent: z.number() }),
        version: z.number(),
      })
      .parse((await merchant.get('/api/merchant/agent')).body);
    const tooLow = await merchant.put('/api/merchant/agent', {
      rules: { ...agent.rules, maxDiscountPercent: 5 },
      version: agent.version,
    });
    expect(tooLow.status).toBe(409);
    const saved = await merchant.put('/api/merchant/agent', {
      rules: { ...agent.rules, maxDiscountPercent: 12 },
      version: agent.version,
    });
    expect(saved.status).toBe(200);
    const stale = await merchant.put('/api/merchant/agent', {
      rules: { ...agent.rules, maxDiscountPercent: 20 },
      version: agent.version,
    });
    expect(stale.status).toBe(409);
    const need = needViewSchema.parse(
      (await browser(world.app).post('/api/commerce/needs', needRequest())).body,
    );
    expect(need.offers[0]?.reward.percent).toBeLessThanOrEqual(12);
    expect(need.offers[0]?.reward.percent).toBeGreaterThanOrEqual(10);
  });

  it('shows the conversation to its merchant by alias only, and to no other merchant', async () => {
    world = await commerceWorld();
    await browser(world.app).post('/api/commerce/needs', needRequest());
    const owner = await merchantSession(world);
    const requests = z
      .object({ requests: z.array(merchantRequestSchema) })
      .parse((await owner.get('/api/merchant/requests')).body).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0]?.alias).toBe('Mia');
    const text = JSON.stringify(requests);
    expect(text).not.toMatch(/traveller|@|journey/i);
    const other = await merchantSession(world, 'demo-uptown-smash-co');
    expect((await other.get(`/api/merchant/requests/${requests[0]?.threadId ?? ''}`)).status).toBe(
      403,
    );
  });

  it('moves a kitchen ticket only forward, and leaves the pickup to the scan', async () => {
    world = await commerceWorld();
    const traveller = browser(world.app);
    const need = needViewSchema.parse(
      (await traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    const reservation = reservationSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
    );
    world.paypal.approve(reservation.paypalOrderId);
    const order = orderViewSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/confirm`)).body,
    );
    const merchant = await merchantSession(world);
    const tickets = z
      .object({ tickets: z.array(kitchenTicketSchema) })
      .parse((await merchant.get('/api/merchant/tickets')).body).tickets;
    expect(tickets[0]?.lines[0]).toMatchObject({
      name: 'Vegan miso ramen',
      changes: 'without scallions, without peanut chili oil',
    });
    const path = `/api/merchant/tickets/${order.id}/status`;
    expect((await merchant.post(path, { status: 'preparing' })).status).toBe(200);
    expect((await merchant.post(path, { status: 'ready' })).status).toBe(200);
    expect((await merchant.post(path, { status: 'preparing' })).status).toBe(409);
    expect((await merchant.post(path, { status: 'picked_up' })).status).toBe(400);
    expect((await traveller.post(`/api/commerce/orders/${order.id}/cancel`)).status).toBe(409);
  });

  it('sums the day in "Today" once an order is collected', async () => {
    world = await commerceWorld();
    const { order, merchant } = await collectedOrder(world);
    const today = merchantTodaySchema.parse((await merchant.get('/api/merchant/today')).body);
    expect(today).toMatchObject({
      orders: 1,
      offers: 1,
      conversionPercent: 100,
      sales: order.reward.price,
    });
    expect(today.merchant.demo).toBe(true);
  });
});

describe('payouts to the merchant', () => {
  it('pays the net of the collected sales once, however often it is asked, even at once', async () => {
    const payouts = fakePayouts({ value: 'PENDING' });
    world = await commerceWorld({ payouts });
    const { order, merchant } = await collectedOrder(world);
    const [first, second] = await Promise.all([
      merchant.post('/api/merchant/payouts/now'),
      merchant.post('/api/merchant/payouts/now'),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const batch = payoutViewSchema.parse(first.status === 201 ? first.body : second.body);
    const gross = order.reward.price.amountMinor;
    expect(batch).toMatchObject({
      status: 'pending',
      gross: { amountMinor: gross },
      net: { amountMinor: gross - Math.round(gross * 0.05) },
    });
    expect(payouts.sent).toEqual([
      { receiver: 'demo-tsuki-ramen-house@example.com', amountMinor: batch.net.amountMinor },
    ]);
  });

  it('makes the sales payable again when PayPal denies the batch', async () => {
    const status = { value: 'DENIED' as 'PENDING' | 'DENIED' };
    const payouts = fakePayouts(status);
    world = await commerceWorld({ payouts });
    const { merchant } = await collectedOrder(world);
    expect(
      payoutViewSchema.parse((await merchant.post('/api/merchant/payouts/now')).body).status,
    ).toBe('denied');
    status.value = 'PENDING';
    expect(
      payoutViewSchema.parse((await merchant.post('/api/merchant/payouts/now')).body).status,
    ).toBe('pending');
    expect(payouts.sent).toHaveLength(2);
  });
});
