import {
  agentPreviewSchema,
  agentSetupSchema,
  needViewSchema,
  orderViewSchema,
  reservationSchema,
  savedRulesSchema,
  scanRefusalSchema,
  type WeeklyHours,
} from '@moviq/contracts';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../src/infrastructure/http/errors.js';
import type { MerchantAgent } from '../../src/modules/commerce/agent.js';
import { merchantRoutes } from '../../src/modules/commerce/merchant-routes.js';
import { memoryLogger } from '../support/memory-logger.js';
import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';
import { merchantSession } from './support/orders.js';

let world: CommerceWorld | undefined;

afterEach(async () => {
  await world?.temp.dispose();
  world = undefined;
});

const ramen = 'demo-tsuki-ramen-house';
const errorSchema = z.object({ error: z.object({ message: z.string() }) });

async function agentOf(merchant: Awaited<ReturnType<typeof merchantSession>>) {
  return agentSetupSchema.parse((await merchant.get('/api/merchant/agent')).body);
}

/** An agent that must never be asked: the preview composes from the rules alone. */
const untouchable: MerchantAgent = {
  respond: () => Promise.reject(new Error('The preview must not use the model.')),
};

describe('the opening hours of "Your agent" (F-J9-08)', () => {
  it('reads the hours seeded from the single daily range, the same every day', async () => {
    world = await commerceWorld();
    const agent = await agentOf(await merchantSession(world));
    expect(agent.hours.wed).toEqual([{ opens: '11:30', closes: '23:00' }]);
    expect(Object.keys(agent.hours)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });

  it('saves new hours under the version, and the offer check follows them', async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const agent = await agentOf(merchant);
    // 18:00 on a Wednesday in New York: closed from 15:00 that day, open the others.
    const hours: WeeklyHours = {
      ...agent.hours,
      wed: [
        { opens: '08:00', closes: '11:00' },
        { opens: '12:00', closes: '15:00' },
      ],
    };
    const saved = await merchant.put('/api/merchant/agent', {
      rules: agent.rules,
      version: agent.version,
      hours,
    });
    expect(saved.status).toBe(200);
    expect(savedRulesSchema.parse(saved.body)).toMatchObject({ version: agent.version + 1, hours });
    expect((await agentOf(merchant)).hours.wed).toHaveLength(2);
    const need = needViewSchema.parse(
      (await browser(world.app).post('/api/commerce/needs', needRequest())).body,
    );
    const thread = need.threads.find((candidate) => candidate.merchantId === ramen);
    const checks = thread?.conversation.flatMap((entry) =>
      entry.message.type === 'check' ? entry.message.refusals.map((r) => r.reason) : [],
    );
    expect(checks).toContain('closed');
    expect(need.offers.some((offer) => offer.merchant.id === ramen)).toBe(false);
  });

  it('keeps the hours when the rules come without them', async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const agent = await agentOf(merchant);
    const saved = await merchant.put('/api/merchant/agent', {
      rules: { ...agent.rules, prepMinutes: 20 },
      version: agent.version,
    });
    expect(savedRulesSchema.parse(saved.body).hours).toEqual(agent.hours);
  });

  it('refuses hours that close before they open, overlap, or never open', async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const agent = await agentOf(merchant);
    const put = (hours: unknown) =>
      merchant.put('/api/merchant/agent', { rules: agent.rules, version: agent.version, hours });
    const backwards = await put({ ...agent.hours, mon: [{ opens: '18:00', closes: '09:00' }] });
    expect(backwards.status).toBe(409);
    expect(errorSchema.parse(backwards.body).error.message).toBe(
      'On Monday a stretch closes before it opens.',
    );
    const overlapping = await put({
      ...agent.hours,
      fri: [
        { opens: '08:00', closes: '14:00' },
        { opens: '13:00', closes: '20:00' },
      ],
    });
    expect(errorSchema.parse(overlapping.body).error.message).toMatch(/^On Friday/);
    const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    expect(errorSchema.parse((await put(closed)).body).error.message).toMatch(/at least one/);
    expect((await put({ ...agent.hours, sun: [{ opens: '9:00', closes: '12:00' }] })).status).toBe(
      400,
    );
    expect((await agentOf(merchant)).version).toBe(agent.version);
  });
});

describe('the preview of "Your agent" (F-J9-09)', () => {
  it('composes from the rules for three example customers, saving nothing and never the model', async () => {
    world = await commerceWorld({ agent: untouchable });
    const merchant = await merchantSession(world);
    const answer = await merchant.get('/api/merchant/agent/preview');
    expect(answer.status).toBe(200);
    const preview = agentPreviewSchema.parse(answer.body);
    expect(preview.composer).toBe('rules');
    expect(preview.cases.map((c) => c.example)).toEqual([
      'no-preferences',
      'vegetarian',
      'allergies',
    ]);
    const allergic = preview.cases[2];
    expect(allergic?.preferences.allergies).toContain('peanuts');
    expect(allergic?.outcome).toMatchObject({ kind: 'accepted' });
    if (allergic?.outcome.kind === 'accepted') {
      expect(allergic.outcome.reward.percent).toBeGreaterThanOrEqual(10);
      expect(allergic.outcome.lines[0]?.changes).toMatch(/without/);
    }
    const requests = z
      .object({ requests: z.array(z.unknown()) })
      .parse((await merchant.get('/api/merchant/requests')).body).requests;
    expect(requests).toEqual([]);
  });

  it('shows the check refusing the offers when the rules leave the merchant closed now', async () => {
    world = await commerceWorld();
    const merchant = await merchantSession(world);
    const agent = await agentOf(merchant);
    await merchant.put('/api/merchant/agent', {
      rules: agent.rules,
      version: agent.version,
      hours: { ...agent.hours, wed: [] },
    });
    const preview = agentPreviewSchema.parse(
      (await merchant.get('/api/merchant/agent/preview')).body,
    );
    const outcome = preview.cases[0]?.outcome;
    expect(outcome?.kind).toBe('rejected');
    if (outcome?.kind === 'rejected') {
      expect(outcome.refusals.map((r) => r.reason)).toContain('closed');
    }
  });
});

describe('the reasons of a refused scan, by code', () => {
  async function reservedOrder(current: CommerceWorld) {
    const traveller = browser(current.app);
    const need = needViewSchema.parse(
      (await traveller.post('/api/commerce/needs', needRequest())).body,
    );
    const offerId = need.offers[0]?.id ?? '';
    const reservation = reservationSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
    );
    current.paypal.approve(reservation.paypalOrderId);
    return orderViewSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offerId}/confirm`)).body,
    );
  }

  const reasonOf = (body: unknown) => scanRefusalSchema.parse(body).error.reason;

  it('says not-moviq, other-merchant, used and expired, keeping the sentence', async () => {
    world = await commerceWorld();
    const order = await reservedOrder(world);
    const qr = order.pickup?.qr ?? '';
    const owner = await merchantSession(world);
    const other = await merchantSession(world, 'demo-uptown-smash-co');
    const garbage = await owner.post('/api/merchant/scan', { code: 'hello' });
    expect(scanRefusalSchema.parse(garbage.body).error).toMatchObject({
      code: 'conflict',
      reason: 'not-moviq',
      message: 'This is not a MovIQ pickup code.',
    });
    expect(reasonOf((await other.post('/api/merchant/scan', { code: qr })).body)).toBe(
      'other-merchant',
    );
    expect((await owner.post('/api/merchant/scan', { code: qr })).status).toBe(200);
    expect(reasonOf((await owner.post('/api/merchant/scan', { code: qr })).body)).toBe('used');
    const next = await reservedOrder(world);
    world.clock.advance(11 * 60_000);
    expect(reasonOf((await owner.post('/api/merchant/scan', { code: next.pickup?.qr })).body)).toBe(
      'expired',
    );
  });

  it('says payments-off when PayPal is not set up on the server', async () => {
    world = await commerceWorld();
    const off = new Hono<AppBindings>();
    off.use(requestContext(memoryLogger().logger));
    off.route(
      '/api/merchant',
      merchantRoutes({
        ...world.deps,
        payments: { available: false, reason: 'PayPal is not set up on this server.' },
      }),
    );
    off.onError(unexpectedError);
    const merchant = browser(off);
    await merchant.post('/api/merchant/session', { token: MERCHANT_TEST_TOKEN, merchantId: ramen });
    const refused = await merchant.post('/api/merchant/scan', { code: 'anything' });
    expect(refused.status).toBe(409);
    expect(scanRefusalSchema.parse(refused.body).error).toMatchObject({
      reason: 'payments-off',
      message: 'PayPal is not set up on this server.',
    });
  });
});
