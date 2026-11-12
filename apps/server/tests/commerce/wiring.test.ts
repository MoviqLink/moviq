import type { Transaction } from '@libsql/client';
import { needViewSchema, orderViewSchema, reservationSchema } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import type { LeaderTerm } from '../../src/infrastructure/jobs/leadership.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import { settleMerchants } from '../../src/modules/commerce/jobs.js';
import { commercePurchases } from '../../src/modules/commerce/hold-purchases.js';
import { rulesAgent } from '../../src/modules/commerce/rules-agent.js';
import { runRewardTool } from '../../src/modules/commerce/sara-tools.js';
import { commerceSetup } from '../../src/modules/commerce/setup.js';
import { holdLedger } from '../../src/modules/payments/holds/hold-ledger.js';
import { reconcileHolds } from '../../src/modules/payments/holds/hold-reconcile.js';
import { payoutLedger } from '../../src/modules/payments/payouts/payout-ledger.js';
import type { PayPalPayouts } from '../../src/modules/payments/paypal/payouts.js';
import { memoryLogger } from '../support/memory-logger.js';
import {
  browser,
  commerceWorld,
  needRequest,
  TASTE,
  type CommerceWorld,
} from './support/commerce.js';

let world: CommerceWorld | undefined;

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

/** A leader term that writes straight to the database until the test aborts it. */
function term(current: CommerceWorld, controller: AbortController): LeaderTerm {
  return {
    name: 'worker',
    holder: 'test',
    fencingToken: 1,
    signal: controller.signal,
    fenced: <T>(work: (tx: Transaction) => Promise<T>) => current.db.transaction(work),
  };
}

async function untilStopped(
  run: Promise<void>,
  controller: AbortController,
  check: () => Promise<boolean>,
) {
  for (let attempt = 0; attempt < 50 && !(await check()); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await run;
}

describe('building commerce from the configuration', () => {
  it('uses the rules agent without a model and has no payouts without PayPal keys', async () => {
    world = await commerceWorld();
    const built = commerceSetup({
      config: { integrations: resolveIntegrations({}), paypalEnv: 'sandbox' },
      settings: world.deps.settings,
      db: world.db,
      clock: world.clock,
      http: createHttpClient(),
      logger: memoryLogger().logger,
      payments: world.deps.payments,
      model: undefined,
      budget: createTokenBudget(world.db, world.clock, 1000),
      secureCookies: false,
    });
    expect(built.agent).toBe(rulesAgent);
    expect(built.payouts).toBeUndefined();
  });
});

describe('the worker jobs of commerce', () => {
  it('authorizes, in reconciliation, an order the buyer approved whose confirmation never arrived', async () => {
    world = await commerceWorld();
    const current = world;
    const traveller = browser(current.app);
    const need = needViewSchema.parse(
      (await traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    const reservation = reservationSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
    );
    current.paypal.approve(reservation.paypalOrderId);
    // The confirmation is lost; the offer still holds when reconciliation looks.
    current.clock.advance(3 * 60_000);
    const controller = new AbortController();
    const run = reconcileHolds(term(current, controller), {
      db: current.db,
      clock: current.clock,
      logger: memoryLogger().logger,
      purchases: commercePurchases({ clock: current.clock }),
      setup: current.deps.payments,
      intervalMs: 5,
    });
    await untilStopped(
      run,
      controller,
      async () => (await holdLedger.find(current.db, reservation.holdId))?.status === 'authorized',
    );
    expect((await holdLedger.find(current.db, reservation.holdId))?.status).toBe('authorized');
    const orders = z
      .object({ orders: z.array(orderViewSchema) })
      .parse((await traveller.get('/api/commerce/orders')).body).orders;
    expect(orders).toHaveLength(1);
  });

  it('pays each merchant once a week for what was collected before that week', async () => {
    const sent: number[] = [];
    const payouts: PayPalPayouts = {
      createBatch: (input) => {
        sent.push(input.amount.amountMinor);
        return Promise.resolve({
          batch_header: {
            payout_batch_id: 'PB1',
            batch_status: 'PENDING',
            sender_batch_header: { sender_batch_id: input.senderBatchId },
          },
        });
      },
      getBatch: () =>
        Promise.resolve({
          batch_header: {
            payout_batch_id: 'PB1',
            batch_status: 'SUCCESS',
            sender_batch_header: { sender_batch_id: 'x' },
          },
        }),
    };
    world = await commerceWorld({ payouts });
    const current = world;
    const traveller = browser(current.app);
    const need = needViewSchema.parse(
      (await traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    const reservation = reservationSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
    );
    current.paypal.approve(reservation.paypalOrderId);
    const order = orderViewSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/confirm`)).body,
    );
    const merchant = browser(current.app);
    await merchant.post('/api/merchant/session', {
      token: MERCHANT_TEST_TOKEN,
      merchantId: 'demo-tsuki-ramen-house',
    });
    await merchant.post('/api/merchant/scan', { code: order.pickup?.qr });
    current.clock.advance(7 * 24 * 60 * 60_000);
    const controller = new AbortController();
    const run = settleMerchants(term(current, controller), {
      ...current.deps,
      logger: memoryLogger().logger,
      intervalMs: 5,
    });
    await untilStopped(
      run,
      controller,
      async () => (await payoutLedger.forMerchant(current.db, 'demo-tsuki-ramen-house')).length > 0,
    );
    expect(sent).toHaveLength(1);
    expect((await payoutLedger.forMerchant(current.db, 'demo-tsuki-ramen-house'))[0]?.status).toBe(
      'pending',
    );
  });
});

describe("Sara's commerce tools", () => {
  it('find rewards on the journey and open the PayPal reservation, never holding money themselves', async () => {
    world = await commerceWorld();
    const traveller = browser(world.app);
    await traveller.post('/api/commerce/needs', needRequest({ alias: 'Mia' }));
    const travellerId = z
      .object({ id: z.string() })
      .parse((await world.db.query('SELECT id FROM travellers')).rows[0]).id;
    const ctx = {
      deps: world.deps,
      logger: memoryLogger().logger,
      travellerId,
      journeyId: 'no-such-journey',
      alias: 'Mia',
      taste: TASTE,
      language: 'es' as const,
    };
    const missing = await runRewardTool(
      { callId: 'c1', name: 'find_rewards', arguments: { craving: 'ramen' } },
      ctx,
    );
    expect(missing.output).toContain('There is no journey with that id.');
    const offerId = z
      .object({ id: z.string() })
      .parse(
        (await world.db.query("SELECT id FROM commerce_offers WHERE status = 'open'")).rows[0],
      ).id;
    const reserved = await runRewardTool(
      { callId: 'c2', name: 'reserve_offer', arguments: { offer_id: offerId } },
      ctx,
    );
    const answer = z.object({ paypal_order_id: z.string() }).parse(JSON.parse(reserved.output));
    expect(answer.paypal_order_id).toMatch(/^ORDER/);
    expect(world.paypal.calls.map((call) => call.method)).toEqual(['createOrder']);
    const refused = await runRewardTool(
      { callId: 'c3', name: 'reserve_offer', arguments: { offer_id: offerId, amount: 1 } },
      ctx,
    );
    expect(refused.output).toContain('error');
  });
});
