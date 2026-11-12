import { needViewSchema, orderViewSchema, reservationSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';

let world: CommerceWorld;

beforeEach(async () => {
  world = await commerceWorld();
});

afterEach(async () => {
  await world.temp.dispose();
});

/** A traveller asks for ramen, reserves the recommended offer and approves it in PayPal. */
async function reserved(traveller = browser(world.app)) {
  const need = needViewSchema.parse(
    (await traveller.post('/api/commerce/needs', needRequest())).body,
  );
  const offer = need.offers.find((candidate) => candidate.recommended);
  if (offer === undefined) throw new Error('no recommended offer');
  const reservation = reservationSchema.parse(
    (await traveller.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'es' })).body,
  );
  world.paypal.approve(reservation.paypalOrderId);
  const confirmed = await traveller.post(`/api/commerce/offers/${offer.id}/confirm`);
  return {
    traveller,
    offer,
    reservation,
    order: orderViewSchema.parse(confirmed.body),
    status: confirmed.status,
  };
}

async function signedInMerchant(merchantId = 'demo-tsuki-ramen-house') {
  const merchant = browser(world.app);
  expect(
    (await merchant.post('/api/merchant/session', { token: MERCHANT_TEST_TOKEN, merchantId }))
      .status,
  ).toBe(200);
  return merchant;
}

const scanSchema = z.object({
  code: z.string(),
  status: z.string(),
  charged: z.object({ amountMinor: z.number() }),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

describe('a craving on the way, from the offer to the pickup', () => {
  it('answers a craving with an offer made for the traveller and validated by the server', async () => {
    const response = await browser(world.app).post('/api/commerce/needs', needRequest());
    expect(response.status).toBe(201);
    const need = needViewSchema.parse(response.body);
    const [offer] = need.offers;
    expect(offer?.merchant).toMatchObject({ name: 'Tsuki Ramen House', demo: true });
    expect(offer?.lines.map((line) => line.name)).toEqual(['Vegan miso ramen', 'Cola']);
    expect(offer?.lines[0]?.changes).toBe('without scallions, without peanut chili oil');
    expect(offer?.reward.percent).toBeGreaterThanOrEqual(10);
    expect(offer?.composer).toBe('rules');
    expect(offer?.recommended).toBe(true);
    const types = need.threads[0]?.conversation.map((entry) => entry.message.type);
    expect(types).toEqual(['need', 'offer', 'check', 'recommendation']);
  });

  it('says so plainly when no merchant on the way can make it', async () => {
    const need = needViewSchema.parse(
      (
        await browser(world.app).post(
          '/api/commerce/needs',
          needRequest({ craving: 'sushi omakase' }),
        )
      ).body,
    );
    expect(need.offers).toEqual([]);
    expect(need.message).toBe('No merchant on your next stops can make it for you right now.');
  });

  it('reserves with a PayPal authorization at the server price, and creates one order once approved', async () => {
    const { offer, reservation, order, status } = await reserved();
    expect(reservation.amount).toEqual(offer.reward.price);
    const paypalOrder = world.paypal.order(reservation.paypalOrderId);
    expect(paypalOrder?.input.intent).toBe('AUTHORIZE');
    expect(paypalOrder?.input.presentation?.brandName).toBe('MovIQ');
    expect(paypalOrder?.input.presentation?.locale).toBe('es-US');
    expect(paypalOrder?.input.presentation?.discount).toEqual(offer.reward.earned);
    expect(status).toBe(200);
    expect(order).toMatchObject({
      status: 'reserved',
      freeCancellation: true,
      payment: { status: 'authorized' },
    });
    expect(order.code).toMatch(/^T-\d{4}$/);
    expect(order.pickup?.qr).toMatch(/^mq1\./);
  });

  it('creates no order and holds nothing while the buyer has not approved in PayPal', async () => {
    const traveller = browser(world.app);
    const need = needViewSchema.parse(
      (await traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' });
    const early = await traveller.post(`/api/commerce/offers/${offerId}/confirm`);
    expect(early.status).toBe(409);
    expect(
      z
        .object({ orders: z.array(z.unknown()) })
        .parse((await traveller.get('/api/commerce/orders')).body).orders,
    ).toEqual([]);
  });

  it('charges once when the counter scans the code, and refuses the code a second time', async () => {
    const { order } = await reserved();
    const merchant = await signedInMerchant();
    const first = await merchant.post('/api/merchant/scan', { code: order.pickup?.qr });
    expect(first.status).toBe(200);
    expect(scanSchema.parse(first.body)).toMatchObject({
      code: order.code,
      status: 'picked_up',
      charged: { amountMinor: order.reward.price.amountMinor },
    });
    const second = await merchant.post('/api/merchant/scan', { code: order.pickup?.qr });
    expect(second.status).toBe(409);
    expect(errorSchema.parse(second.body).error.message).toBe(
      'This code has already been used. Nothing more has been charged.',
    );
    expect(world.paypal.captures()).toBe(1);
  });

  it('refuses an altered or expired code without charging', async () => {
    const { order } = await reserved();
    const merchant = await signedInMerchant();
    const qr = order.pickup?.qr ?? '';
    const altered = `${qr.slice(0, -2)}${qr.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await merchant.post('/api/merchant/scan', { code: altered })).status).toBe(409);
    world.clock.advance(11 * 60_000);
    const expired = await merchant.post('/api/merchant/scan', { code: qr });
    expect(errorSchema.parse(expired.body).error.message).toMatch(/expired/);
    expect(world.paypal.captures()).toBe(0);
  });

  it("refuses a code scanned at another merchant's counter", async () => {
    const { order } = await reserved();
    const other = await signedInMerchant('demo-uptown-smash-co');
    expect((await other.post('/api/merchant/scan', { code: order.pickup?.qr })).status).toBe(403);
    expect(world.paypal.captures()).toBe(0);
  });

  it('cancels for free before the kitchen starts: the authorization is voided', async () => {
    const { traveller, order } = await reserved();
    const cancelled = await traveller.post(`/api/commerce/orders/${order.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(orderViewSchema.parse(cancelled.body)).toMatchObject({
      status: 'cancelled',
      payment: { status: 'voided' },
      pickup: null,
    });
    expect(world.paypal.captures()).toBe(0);
  });

  it('refuses to cancel once the kitchen has started', async () => {
    const { traveller, order } = await reserved();
    world.clock.advance(
      new Date(order.kitchenStartsAt).getTime() - world.clock.now().getTime() + 1_000,
    );
    const late = await traveller.post(`/api/commerce/orders/${order.id}/cancel`);
    expect(late.status).toBe(409);
    expect(world.paypal.calls.filter((call) => call.method === 'voidAuthorization')).toHaveLength(
      0,
    );
  });

  it('keeps an order private: another traveller gets 403 reading or cancelling it', async () => {
    const { order } = await reserved();
    const stranger = browser(world.app);
    await stranger.post('/api/commerce/needs', needRequest({ alias: 'Leo' }));
    expect((await stranger.get(`/api/commerce/orders/${order.id}`)).status).toBe(403);
    expect((await stranger.post(`/api/commerce/orders/${order.id}/cancel`)).status).toBe(403);
  });

  it('refunds a missing line through PayPal, once', async () => {
    const { order } = await reserved();
    const merchant = await signedInMerchant();
    await merchant.post('/api/merchant/scan', { code: order.pickup?.qr });
    const refund = await merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [1] });
    expect(refund.status).toBe(200);
    const again = await merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [1] });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toContain('already refunded through PayPal');
    expect(world.paypal.refunds()).toBe(1);
    const told = await world.db.query(
      `SELECT COUNT(*) AS n FROM commerce_messages
        WHERE type = 'payment' AND json_extract(body, '$.step') = 'refunded'`,
    );
    expect(Number(told.rows[0]?.['n'])).toBe(1);
  });
});
