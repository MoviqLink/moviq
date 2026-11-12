import { assistantTurnSchema, paymentSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import { journeyPurchases } from '../../src/modules/journeys/purchases.js';
import { journeyStore } from '../../src/modules/journeys/journey-store.js';
import { availableSetup, paymentsApp } from '../payments/support/api.js';
import { fakePayPal } from '../payments/support/fake-paypal.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { assistantDatabase, calls, scriptedModel, text } from './doubles.js';
import { harness, type HarnessOptions } from './harness.js';
import { atRiskJourney, ownerOf, post } from './trip-doubles.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  clock = manualClock('2026-11-11T22:31:00.000Z');
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

async function traveller(options: Partial<HarnessOptions>) {
  const built = harness({ db, clock, ...options });
  const cookie = await ownerOf(built.app, db, atRiskJourney());
  const ask = async (message: string, lang: 'en' | 'es' = 'es') => {
    const response = await built.app.request(
      '/api/assistant/turns',
      post({ conversationId: null, journeyId: 'journey-1', message, lang }, cookie),
    );
    expect(response.status).toBe(200);
    return assistantTurnSchema.parse(await response.json());
  };
  return { ...built, cookie, ask };
}

const TAXI = '¿Y si voy en taxi?';
const TAXI_WORDS =
  'Puedes ir en el taxi de nuestro socio de demo por 34,50 US$ y llegar a las 18:40; lo ' +
  'pagas con PayPal y no se cobra nada hasta que PayPal lo confirme.';

describe('Sara answers about the trip under watch', () => {
  it('proposes the taxi at the price the server quotes, and PayPal creates the order at that price', async () => {
    const model = scriptedModel([calls(['propose_alternative', { option: 2 }]), text(TAXI_WORDS)]);
    const { ask, cookie } = await traveller({ model });
    const turn = await ask(TAXI);
    expect(turn.mode).toBe('ai');
    expect(turn.reply).toBe(TAXI_WORDS);
    expect(turn.proposal).toEqual({
      alternativeId: 'alt-taxi',
      price: { amountMinor: 3450, currency: 'USD' },
    });
    const offered = model.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(offered).toContain('propose_alternative');
    expect(JSON.parse(model.results[1]?.[0]?.output ?? '{}')).toMatchObject({
      proposed: 'taxi',
      price: '34,50 US$',
    });

    const paypal = fakePayPal();
    const payments = paymentsApp({
      db,
      clock,
      catalog: journeyPurchases({ db, clock }),
      setup: availableSetup(paypal),
    });
    const purpose = {
      kind: 'journey-alternative',
      journeyId: 'journey-1',
      alternativeId: turn.proposal?.alternativeId,
    };
    const priced = await payments.request(
      '/api/payments/orders',
      post({ purpose, amount: { amountMinor: 1, currency: 'USD' } }, cookie),
    );
    expect(priced.status).toBe(400);
    const created = await payments.request('/api/payments/orders', post({ purpose }, cookie));
    expect(created.status).toBe(200);
    const payment = paymentSchema.parse(await created.json());
    expect(payment.amount).toEqual({ amountMinor: 3450, currency: 'USD' });
    expect(payment.status).toBe('created');
    expect(paypal.order(payment.paypalOrderId)?.input.amount).toEqual(payment.amount);
    // Nothing is applied before PayPal confirms: the trip is still on its planned route.
    const stored = await journeyStore.get(db, 'journey-1');
    expect(stored?.journey.itinerary.id).toBe('planned');
    expect(stored?.journey.alternatives).toHaveLength(2);
  });

  it('replaces a price the server did not give by the fixed words, keeping the proposal', async () => {
    const model = scriptedModel([
      calls(['propose_alternative', { option: 2 }]),
      text('El taxi te cuesta 20 US$ y llegas a las 18:40.'),
    ]);
    const { ask, log } = await traveller({ model });
    const turn = await ask(TAXI);
    expect(turn.reply).not.toContain('20 US$');
    expect(turn.reply).toContain('34,50 US$, precio fijado por nuestro servidor');
    expect(turn.proposal?.alternativeId).toBe('alt-taxi');
    expect(log.text()).toContain('sara trip words replaced by the fixed words');
  });

  it('refuses an option that does not exist and proposes nothing', async () => {
    const model = scriptedModel([
      calls(['propose_alternative', { option: 3 }]),
      text('There is no such option on offer now.'),
    ]);
    const { ask } = await traveller({ model });
    const turn = await ask('Can I take option 3?', 'en');
    expect(turn.proposal ?? null).toBeNull();
    expect(JSON.parse(model.results[1]?.[0]?.output ?? '{}')).toEqual({
      error: 'There is no option 3.',
    });
  });

  it('without a model, says so and gives the watch’s own sentence', async () => {
    const { ask } = await traveller({ model: undefined });
    const turn = await ask('¿Llego?');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toBe(
      'Mi IA no está conectada, así que solo puedo darte lo que dice la vigilancia. La ' +
        'vigilancia dice, en inglés: «Arriving about 18:52, only 3 min to spare.»',
    );
    expect(turn.proposal ?? null).toBeNull();
  });

  it("refuses a question about another traveller's trip", async () => {
    const { app } = await traveller({});
    const response = await app.request('/api/assistant/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId: null,
        journeyId: 'journey-1',
        message: '¿Llego?',
        lang: 'es',
      }),
    });
    expect(response.status).toBe(404);
  });
});
