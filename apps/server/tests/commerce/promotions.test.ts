import { agentSetupSchema, needViewSchema, routePromotionsSchema } from '@moviq/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { z } from 'zod';

import { journeyStore } from '../../src/modules/journeys/journey-store.js';
import { merchantStore } from '../../src/modules/commerce/merchants.js';
import { atRiskJourney } from '../assistant/trip-doubles.js';
import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';
import { browser, commerceWorld, needRequest, type CommerceWorld } from './support/commerce.js';

let world: CommerceWorld;
beforeEach(async () => {
  world = await commerceWorld();
});
afterEach(async () => {
  await world.temp.dispose();
});

it('shows only the owner the featured products on the route and reflects business changes', async () => {
  const traveller = browser(world.app);
  await traveller.post('/api/commerce/needs', needRequest());
  const owner = z
    .object({ id: z.string() })
    .parse((await world.db.query('SELECT id FROM travellers')).rows[0]).id;
  const merchant = await merchantStore.find(world.db, 'demo-tsuki-ramen-house');
  if (merchant === undefined) throw new Error('Missing merchant');
  const base = atRiskJourney('promotion-trip');
  const leg = base.itinerary.legs[0];
  if (leg === undefined) throw new Error('Missing leg');
  const { lat, lon } = merchant.stopAt;
  const journey = {
    ...base,
    itinerary: {
      ...base.itinerary,
      legs: [
        {
          ...leg,
          departAt: '2026-11-11T23:10:00.000Z',
          arriveAt: '2026-11-11T23:30:00.000Z',
          path: [
            [lon - 0.001, lat],
            [lon + 0.001, lat],
          ] as [number, number][],
        },
      ],
    },
  };
  await journeyStore.create(world.db, journey, owner, world.clock.now());
  const url = `/api/commerce/journeys/${journey.id}/promotions`;
  expect((await browser(world.app).get(url)).status).toBe(404);
  const first = routePromotionsSchema.parse((await traveller.get(url)).body);
  expect(first.promotions).toHaveLength(1);
  expect(first.promotions.every((item) => item.merchant.id === merchant.summary.id)).toBe(true);
  const promotion = first.promotions[0];
  if (promotion === undefined) throw new Error('Missing promotion');
  expect(promotion).toMatchObject({
    merchant: { id: merchant.summary.id, demo: true },
    itemId: 'tr-miso-vegan',
  });
  const setup = await merchantStore.setup(world.db, merchant);
  expect(promotion.listPrice.amountMinor).toBe(
    setup.menu.find((item) => item.id === promotion.itemId)?.priceMinor,
  );
  const requested = needViewSchema.parse(
    (
      await traveller.post(
        '/api/commerce/needs',
        needRequest({ craving: promotion.name, route: { journeyId: journey.id } }),
      )
    ).body,
  );
  expect(requested.offers.some((offer) => offer.merchant.id === merchant.summary.id)).toBe(true);
  const messages = JSON.stringify(requested.threads.flatMap((thread) => thread.conversation));
  expect(messages).not.toContain(journey.id);
  expect(messages).not.toContain(String(lat));
  expect(messages).not.toContain(String(lon));
  const business = browser(world.app);
  expect(
    (
      await business.post('/api/merchant/session', {
        token: MERCHANT_TEST_TOKEN,
        merchantId: merchant.summary.id,
      })
    ).status,
  ).toBe(200);
  const rules = agentSetupSchema.parse((await business.get('/api/merchant/agent')).body);
  expect(
    (
      await business.put('/api/merchant/agent', {
        version: rules.version,
        rules: { ...rules.rules, featuredItemIds: [] },
        hours: rules.hours,
      })
    ).status,
  ).toBe(200);
  expect(routePromotionsSchema.parse((await traveller.get(url)).body).promotions).toHaveLength(0);
  const nextRules = agentSetupSchema.parse((await business.get('/api/merchant/agent')).body);
  expect(
    (
      await business.put('/api/merchant/agent', {
        version: nextRules.version,
        rules: { ...nextRules.rules, featuredItemIds: ['tr-miso-vegan'] },
        hours: { ...nextRules.hours, wed: [] },
      })
    ).status,
  ).toBe(200);
  expect(routePromotionsSchema.parse((await traveller.get(url)).body).promotions).toHaveLength(0);
});
