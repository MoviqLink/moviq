import {
  needViewSchema,
  orderViewSchema,
  payoutViewSchema,
  reservationSchema,
} from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { holdContext } from '../../src/modules/commerce/context.js';
import { reconcileRound } from '../../src/modules/payments/holds/hold-reconcile.js';
import { memoryLogger } from '../support/memory-logger.js';
import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';
import { collectedOrder, fakePayouts } from './support/orders.js';

let world: CommerceWorld | undefined;

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

const MINUTE = 60_000;

async function reconcile(current: CommerceWorld): Promise<void> {
  const ctx = holdContext(current.deps, memoryLogger().logger);
  if (ctx === undefined) throw new Error('PayPal is not set up');
  await reconcileRound(
    { ...ctx, source: 'reconciliation' },
    { signal: AbortSignal.timeout(5000) },
    50,
  );
}

/** An offer reserved and approved in PayPal, not yet confirmed. */
async function approved(current: CommerceWorld) {
  const traveller = browser(current.app);
  const need = needViewSchema.parse(
    (await traveller.post('/api/commerce/needs', needRequest())).body,
  );
  const offer = need.offers[0];
  if (offer === undefined) throw new Error('no offer');
  const reservation = reservationSchema.parse(
    (await traveller.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'en' })).body,
  );
  current.paypal.approve(reservation.paypalOrderId);
  return { traveller, offer, reservation };
}

const ordersOf = async (current: CommerceWorld) =>
  (await current.db.query('SELECT id FROM commerce_orders')).rows.length;

describe('an offer is confirmed only while it holds', () => {
  it('refuses to confirm an offer whose pickup has passed, and holds nothing', async () => {
    world = await commerceWorld();
    const { traveller, offer } = await approved(world);
    world.clock.advance(60 * MINUTE);
    const response = await traveller.post(`/api/commerce/offers/${offer.id}/confirm`);
    expect(response.status).toBe(409);
    expect(await ordersOf(world)).toBe(0);
    expect(world.paypal.calls.filter((call) => call.method === 'authorizeOrder')).toHaveLength(0);
  });

  it('refuses to confirm an offer that expired, even with its pickup still ahead', async () => {
    world = await commerceWorld();
    const { traveller, offer } = await approved(world);
    world.clock.advance(Date.parse(offer.expiresAt) - world.clock.now().getTime());
    expect(Date.parse(offer.pickupAt)).toBeGreaterThan(world.clock.now().getTime());
    expect((await traveller.post(`/api/commerce/offers/${offer.id}/confirm`)).status).toBe(409);
    expect(await ordersOf(world)).toBe(0);
  });

  it('releases what PayPal authorized for an offer that lapsed meanwhile', async () => {
    world = await commerceWorld();
    const { reservation } = await approved(world);
    world.clock.advance(60 * MINUTE);
    await reconcile(world);
    expect(await ordersOf(world)).toBe(0);
    expect(world.paypal.order(reservation.paypalOrderId)?.authorization?.status).toBe('VOIDED');
  });
});

const refundAnswer = z.object({
  ok: z.boolean(),
  message: z.string(),
  refunded: z.object({ amountMinor: z.number() }),
  pending: z.object({ amountMinor: z.number() }),
});

describe('a refund is said as PayPal has it', () => {
  it('answers pending, not refunded, when PayPal has not confirmed it, until it does', async () => {
    world = await commerceWorld();
    const { order, merchant, traveller } = await collectedOrder(world);
    world.paypal.script('refundCapture', 'lose-request');
    const response = await merchant.post(`/api/merchant/orders/${order.id}/refunds`, {
      lines: [0],
    });
    expect(response.status).toBe(202);
    const answer = refundAnswer.parse(response.body);
    expect(answer.refunded.amountMinor).toBe(0);
    expect(answer.pending.amountMinor).toBeGreaterThan(0);
    expect(answer.message).not.toMatch(/Refunded through PayPal/);
    const seen = orderViewSchema.parse(
      (await traveller.get(`/api/commerce/orders/${order.id}`)).body,
    );
    expect(seen.payment.refunded.amountMinor).toBe(0);
    expect(seen.payment.refundPending.amountMinor).toBe(answer.pending.amountMinor);
    world.clock.advance(5 * MINUTE);
    await reconcile(world);
    const settled = orderViewSchema.parse(
      (await traveller.get(`/api/commerce/orders/${order.id}`)).body,
    );
    expect(settled.payment.refunded.amountMinor).toBe(answer.pending.amountMinor);
    expect(settled.payment.refundPending.amountMinor).toBe(0);
    expect(world.paypal.refunds()).toBe(1);
  });
});

const payoutsAnswer = z.object({
  refundsToDeduct: z.object({ amountMinor: z.number() }),
  batches: z.array(payoutViewSchema),
});

describe('a refund after the merchant was paid comes out of the next payouts', () => {
  async function paidThenRefunded(current: CommerceWorld) {
    const first = await collectedOrder(current);
    expect((await first.merchant.post('/api/merchant/payouts/now')).status).toBe(201);
    const refund = await first.merchant.post(`/api/merchant/orders/${first.order.id}/refunds`, {
      lines: [0],
    });
    const refunded = refundAnswer.parse(refund.body).refunded.amountMinor;
    expect(refunded).toBeGreaterThan(0);
    return { ...first, refunded };
  }
  const balance = async (merchant: Awaited<ReturnType<typeof collectedOrder>>['merchant']) =>
    payoutsAnswer.parse((await merchant.get('/api/merchant/payouts')).body).refundsToDeduct
      .amountMinor;

  it.each(['SUCCESS', 'PENDING'] as const)(
    'deducts it once from the next payout, with its commission (first batch %s)',
    async (first) => {
      const payouts = fakePayouts({ value: first });
      world = await commerceWorld({ payouts });
      const { merchant, refunded } = await paidThenRefunded(world);
      expect(await balance(merchant)).toBe(refunded);
      const second = await collectedOrder(world);
      const [a, b] = await Promise.all([
        merchant.post('/api/merchant/payouts/now'),
        merchant.post('/api/merchant/payouts/now'),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const gross = second.order.reward.price.amountMinor - refunded;
      expect(payouts.sent[1]?.amountMinor).toBe(gross - Math.round(gross * 0.05));
      const batch = payoutViewSchema.parse(a.status === 201 ? a.body : b.body);
      expect(batch.refunds.amountMinor).toBe(refunded);
      expect(await balance(merchant)).toBe(0);
      expect((await merchant.post('/api/merchant/payouts/now')).status).toBe(409);
      expect(payouts.sent).toHaveLength(2);
    },
  );

  it('keeps what is owed while there is nothing to deduct it from, and after a denied batch', async () => {
    const status = { value: 'SUCCESS' as 'SUCCESS' | 'DENIED' };
    const payouts = fakePayouts(status);
    world = await commerceWorld({ payouts });
    const { merchant, refunded } = await paidThenRefunded(world);
    expect((await merchant.post('/api/merchant/payouts/now')).status).toBe(409);
    expect(await balance(merchant)).toBe(refunded);
    await collectedOrder(world);
    status.value = 'DENIED';
    const denied = payoutViewSchema.parse((await merchant.post('/api/merchant/payouts/now')).body);
    expect(denied.status).toBe('denied');
    expect(await balance(merchant)).toBe(refunded);
  });

  it('nets a refund made before the payout into it, and asks for it once however often it is sent', async () => {
    const payouts = fakePayouts({ value: 'SUCCESS' });
    world = await commerceWorld({ payouts });
    const { order, merchant } = await collectedOrder(world);
    const [a, b] = await Promise.all([
      merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [0] }),
      merchant.post(`/api/merchant/orders/${order.id}/refunds`, { lines: [0] }),
    ]);
    expect(world.paypal.refunds()).toBe(1);
    const refunded = Math.max(
      ...[a, b].map(
        (answer) => refundAnswer.safeParse(answer.body).data?.refunded.amountMinor ?? 0,
      ),
    );
    const batch = payoutViewSchema.parse((await merchant.post('/api/merchant/payouts/now')).body);
    const gross = order.reward.price.amountMinor - refunded;
    expect(batch.gross.amountMinor).toBe(gross);
    expect(await balance(merchant)).toBe(0);
  });
});
