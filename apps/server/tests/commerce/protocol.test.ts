import { merchantMessageSchema, needMessageSchema, protocolMessageSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { REWARD_TOOLS } from '../../src/modules/commerce/sara-tools.js';
import { merchantStore, type MerchantAgentSetup } from '../../src/modules/commerce/merchants.js';
import { buildNeed } from '../../src/modules/commerce/need.js';
import { checkOffer, type OfferMessage } from '../../src/modules/commerce/offer-check.js';
import { composeByRules } from '../../src/modules/commerce/rules-agent.js';
import { commerceWorld, EVENING, TASTE, type CommerceWorld } from './support/commerce.js';

let world: CommerceWorld;
let ramen: MerchantAgentSetup;

beforeEach(async () => {
  world = await commerceWorld();
  const merchant = await merchantStore.find(world.db, 'demo-tsuki-ramen-house');
  if (merchant === undefined) throw new Error('the demo ramen house is not seeded');
  ramen = await merchantStore.setup(world.db, merchant);
});

afterEach(async () => {
  await world.temp.dispose();
});

const now = new Date(EVENING);
const window = {
  after: new Date(now.getTime() + 30 * 60_000),
  before: new Date(now.getTime() + 60 * 60_000),
};
const need = () =>
  buildNeed({ alias: 'Mia', craving: 'ramen', taste: TASTE, menu: ramen.menu, window });
const offer = (fields: Partial<OfferMessage> = {}): OfferMessage => ({
  type: 'offer',
  from: 'merchant-agent',
  lines: [
    { itemId: 'tr-miso-vegan', quantity: 1, remove: ['scallions', 'peanut chili oil'], add: [] },
  ],
  priceMinor: 1440,
  pickupAt: window.after.toISOString(),
  note: 'Made for you.',
  ...fields,
});
const check = (message: OfferMessage, rules = ramen.rules, ordersInSlot = 0) =>
  checkOffer({
    offer: message,
    need: need(),
    setup: { ...ramen, rules },
    minRewardPercent: 10,
    ordersInSlot,
    earliestPickup: new Date(now.getTime() + 15 * 60_000),
  });
const reasons = (result: ReturnType<typeof check>) =>
  result.ok ? [] : result.refusals.map((r) => r.reason);

describe('the need Sara sends: only what matters for this menu', () => {
  it('carries the alias, the craving, the window and relevant preferences, never personal data', () => {
    const profile = {
      ...TASTE,
      name: 'Mia Torres',
      email: 'mia@example.com',
      phone: '+1 212 555 0101',
      at: { lat: 40.8, lon: -73.9 },
    };
    const message = buildNeed({
      alias: 'Mia',
      craving: 'ramen',
      taste: profile,
      menu: ramen.menu,
      window,
    });
    expect(needMessageSchema.parse(message)).toEqual(message);
    expect(message.preferences).toEqual({
      allergies: ['peanuts'],
      avoid: ['scallions'],
      noAlcohol: true,
      diet: 'any',
      drink: 'cola',
    });
    const text = JSON.stringify(message);
    for (const secret of ['Mia Torres', 'mia@example.com', '555', '40.8'])
      expect(text).not.toContain(secret);
  });

  it('leaves out preferences the menu cannot touch', () => {
    const coffee = buildNeed({
      alias: 'Mia',
      craving: 'a coffee',
      taste: { ...TASTE, allergies: ['shellfish'], drink: 'tea' },
      menu: ramen.menu,
      window,
    });
    expect(coffee.preferences.allergies).toEqual([]);
    expect(coffee.preferences.drink).toBeNull();
  });
});

describe('the protocol refuses what does not fit, never adapting it', () => {
  it('refuses an unknown type, a field more and a price written as text', () => {
    expect(merchantMessageSchema.safeParse({ ...offer(), type: 'discount' }).success).toBe(false);
    expect(merchantMessageSchema.safeParse({ ...offer(), freeDrink: true }).success).toBe(false);
    expect(merchantMessageSchema.safeParse({ ...offer(), priceMinor: '14.40' }).success).toBe(
      false,
    );
    expect(protocolMessageSchema.safeParse({ ...need(), email: 'mia@example.com' }).success).toBe(
      false,
    );
  });
});

describe("the server's check of an offer", () => {
  it('accepts an offer at least the program minimum below the menu, as a reward', () => {
    const result = check(offer());
    expect(result.ok && result.reward).toEqual({
      listPrice: { amountMinor: 1695, currency: 'USD' },
      price: { amountMinor: 1440, currency: 'USD' },
      earned: { amountMinor: 255, currency: 'USD' },
      percent: 15,
    });
  });

  it('refuses an offer less than the program minimum below the menu price', () => {
    expect(reasons(check(offer({ priceMinor: 1600 })))).toEqual(['reward-below-program']);
  });

  it("refuses a discount above the agent's maximum and a price below its margin", () => {
    expect(reasons(check(offer({ priceMinor: 1100 })))).toEqual(['discount-above-maximum']);
    expect(
      reasons(check(offer({ priceMinor: 700 }), { ...ramen.rules, maxDiscountPercent: 60 })),
    ).toEqual(['below-margin']);
  });

  it('refuses an allergen, a disliked ingredient, a change the kitchen does not allow, and alcohol', () => {
    expect(
      reasons(
        check(
          offer({
            lines: [{ itemId: 'tr-miso-vegan', quantity: 1, remove: ['scallions'], add: [] }],
          }),
        ),
      ),
    ).toEqual(['allergen']);
    expect(
      reasons(
        check(
          offer({
            lines: [
              { itemId: 'tr-miso-vegan', quantity: 1, remove: ['peanut chili oil'], add: [] },
            ],
          }),
        ),
      ),
    ).toEqual(['avoided-ingredient']);
    expect(
      reasons(
        check(
          offer({
            lines: [
              {
                itemId: 'tr-miso-vegan',
                quantity: 1,
                remove: ['scallions', 'peanut chili oil', 'wheat noodles'],
                add: [],
              },
            ],
          }),
        ),
      ),
    ).toEqual(['change-not-allowed']);
    const withBeer = offer({
      lines: [...offer().lines, { itemId: 'tr-lager', quantity: 1, remove: [], add: [] }],
      priceMinor: 2000,
    });
    expect(reasons(check(withBeer))).toContain('alcohol');
  });

  it('refuses a full kitchen and a pickup outside the window or the opening hours', () => {
    expect(reasons(check(offer(), ramen.rules, ramen.rules.ordersPerQuarterHour))).toEqual([
      'no-capacity',
    ]);
    expect(
      reasons(check(offer({ pickupAt: new Date(now.getTime() + 5 * 60_000).toISOString() }))),
    ).toEqual(['too-late']);
  });
});

describe('the honest deterministic agent', () => {
  it('composes for the traveller: without what they cannot have, with their drink, never alcohol', () => {
    const reply = composeByRules({
      need: need(),
      setup: ramen,
      history: [],
      minRewardPercent: 10,
      earliestPickup: window.after,
      clarificationsLeft: 2,
    });
    const message = merchantMessageSchema.parse(reply.message);
    if (message.type !== 'offer') throw new Error('expected an offer');
    expect(message.lines).toEqual([
      { itemId: 'tr-miso-vegan', quantity: 1, remove: ['scallions', 'peanut chili oil'], add: [] },
      { itemId: 'tr-cola', quantity: 1, remove: [], add: [] },
    ]);
    expect(check(message).ok).toBe(true);
    expect(reply.composer).toBe('rules');
  });

  it('makes no offer when the merchant cannot keep the program minimum', () => {
    const reply = composeByRules({
      need: need(),
      setup: { ...ramen, rules: { ...ramen.rules, maxDiscountPercent: 5 } },
      history: [],
      minRewardPercent: 10,
      earliestPickup: window.after,
      clarificationsLeft: 2,
    });
    expect(reply.message).toBeNull();
  });
});

describe("Sara's commerce tools", () => {
  it('take no amount: none of them charges, refunds or sets a price', () => {
    const names = REWARD_TOOLS.map((tool) => tool.name);
    expect(names).toEqual(['find_rewards', 'reserve_offer']);
    const parameters = JSON.stringify(REWARD_TOOLS.map((tool) => tool.parameters));
    expect(parameters).not.toMatch(/amount|price|refund|capture/i);
  });
});
