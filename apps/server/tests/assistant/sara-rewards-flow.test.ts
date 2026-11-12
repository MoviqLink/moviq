import { fileURLToPath } from 'node:url';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';

import {
  assistantTurnSchema,
  needViewSchema,
  orderViewSchema,
  reservationSchema,
  type Taste,
} from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { migrate, readMigrations } from '../../src/infrastructure/database/migrations.js';
import { journeyStore } from '../../src/modules/journeys/journey-store.js';
import { browser } from '../commerce/support/commerce.js';
import { CLIENT_ID } from '../payments/support/api.js';
import { fakeHoldPayPal, type FakeHoldPayPal } from '../payments/support/fake-paypal-holds.js';
import { testApp } from '../support/app.js';
import { manualClock } from '../support/manual-clock.js';
import { tempDatabase, type TempDatabase } from '../support/temp-database.js';
import { tripPastTheRamenBar } from './trip-doubles.js';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));
/** Soy rules out the miso ramen; with no spice in the tastes, the tonkotsu's chili oil is asked. */
const TASTE: Taste = {
  allergies: ['peanuts', 'soy'],
  avoid: ['scallions'],
  noAlcohol: true,
  diet: 'any',
  drink: null,
  spice: null,
};

let temp: TempDatabase | undefined;

afterEach(async () => {
  await temp?.dispose();
  temp = undefined;
});

/** The whole application, PayPal's holds in memory, and a traveller who owns the trip. */
async function world() {
  const clock = manualClock('2026-11-11T22:31:00.000Z');
  temp = await tempDatabase();
  const db = await temp.open();
  const migrations = await readMigrations(MIGRATIONS);
  await migrate(db, migrations, clock);
  const paypal: FakeHoldPayPal = fakeHoldPayPal();
  const payments = {
    available: true,
    paypal,
    config: { available: true, clientId: CLIENT_ID, environment: 'sandbox', currency: 'USD' },
    webhookId: undefined,
  } as const;
  const { app } = testApp({ db, migrations, clock, payments });
  const traveller = browser(app);
  await traveller.post('/api/assistant/journeys/none/explanation', { lang: 'es' });
  const owner = z
    .object({ id: z.string() })
    .parse((await db.query('SELECT id FROM travellers')).rows[0]);
  await journeyStore.create(db, tripPastTheRamenBar(), owner.id, clock.now());
  return { app, db, paypal, traveller, travellerId: owner.id };
}

const scanSchema = z.object({
  code: z.string(),
  status: z.literal('picked_up'),
  charged: z.object({ amountMinor: z.number() }),
});

describe('a craving told to Sara, through the mounted API, to the pickup at the counter', () => {
  it('need, question, validated offer, PayPal hold, order with its code, and the scan that charges', async () => {
    const { app, db, paypal, traveller, travellerId } = await world();

    const told = await traveller.post('/api/assistant/turns', {
      conversationId: null,
      journeyId: 'journey-1',
      message: 'Me apetece un ramen',
      lang: 'es',
      shopper: { alias: 'Mia', taste: TASTE },
    });
    expect(told.status).toBe(200);
    const turn = assistantTurnSchema.parse(told.body);
    expect(turn.reply).toContain('Un comercio te pregunta algo antes: contéstalo abajo.');
    const needId = turn.rewards?.needId ?? '';

    const asked = needViewSchema.parse((await traveller.get(`/api/commerce/needs/${needId}`)).body);
    const waiting = asked.threads.find((thread) => thread.status === 'awaiting-traveller');
    const [option] = waiting?.question?.options ?? [];
    expect(waiting?.question?.topic).toBe('spice');
    const answered = await traveller.post(`/api/commerce/needs/${needId}/answers`, {
      threadId: waiting?.id,
      answer: option,
    });
    expect(answered.status).toBe(200);
    const need = needViewSchema.parse(answered.body);
    const offer = need.offers.find((candidate) => candidate.recommended);
    if (offer === undefined) throw new Error('no recommended offer');
    expect(offer.merchant).toMatchObject({ name: 'Tsuki Ramen House', demo: true });
    const said = need.threads[0]?.conversation.map((entry) => entry.message.type);
    expect(said).toEqual(
      expect.arrayContaining([
        'need',
        'clarification',
        'answer',
        'offer',
        'check',
        'recommendation',
      ]),
    );
    const sent = JSON.stringify(need.threads[0]?.conversation[0]);
    expect(sent).toContain('"alias":"Mia"');
    expect(sent).not.toContain(travellerId);

    const reservation = reservationSchema.parse(
      (await traveller.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'es' })).body,
    );
    expect(reservation.amount).toEqual(offer.reward.price);
    paypal.approve(reservation.paypalOrderId);
    const confirmed = await traveller.post(`/api/commerce/offers/${offer.id}/confirm`);
    expect(confirmed.status).toBe(200);
    const order = orderViewSchema.parse(confirmed.body);
    expect(order).toMatchObject({ status: 'reserved', freeCancellation: true });
    const shown = orderViewSchema.parse(
      (await traveller.get(`/api/commerce/orders/${order.id}`)).body,
    );
    expect(shown.pickup?.qr).toEqual(expect.any(String));

    const counter = browser(app);
    const signedIn = await counter.post('/api/merchant/session', {
      token: MERCHANT_TEST_TOKEN,
      merchantId: 'demo-tsuki-ramen-house',
    });
    expect(signedIn.status).toBe(200);
    const scanned = await counter.post('/api/merchant/scan', { code: shown.pickup?.qr });
    expect(scanned.status).toBe(200);
    expect(scanSchema.parse(scanned.body)).toMatchObject({
      code: order.code,
      charged: { amountMinor: offer.reward.price.amountMinor },
    });
    const orders = (await db.query('SELECT status FROM commerce_orders')).rows;
    expect(orders).toEqual([expect.objectContaining({ status: 'picked_up' })]);
  });
});
