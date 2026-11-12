import { fileURLToPath } from 'node:url';

import { apiErrorSchema, journeySchema, type Alternative, type Journey } from '@moviq/contracts';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import { journeyPurchases } from '../src/modules/journeys/purchases.js';
import type { PaymentContext } from '../src/modules/payments/context.js';
import { confirmPayment, startPayment } from '../src/modules/payments/service.js';
import { journeyApp, planAs, postJson } from './support/journey-app.js';
import { fakeRouting, subwayTrip } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { fakePayPal, type FakePayPal } from './payments/support/fake-paypal.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;
let app: Hono;

beforeEach(async () => {
  temp = await tempDatabase();
  db = await temp.open();
  clock = manualClock('2026-11-11T17:00:00.000Z');
  await migrate(
    db,
    await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
    clock,
  );
  app = journeyApp({
    db,
    clock,
    routing: fakeRouting([
      subwayTrip('2026-11-11T18:15:00.000Z', '2026-11-11T18:50:00.000Z'),
      subwayTrip('2026-11-11T18:00:00.000Z', '2026-11-11T18:35:00.000Z'),
    ]),
  });
});

afterEach(async () => {
  await temp.dispose();
});

/** A watched journey on the recommended itinerary, offered one free and one paid alternative. */
async function journeyWithAlternatives(): Promise<{ journey: Journey; cookie: string }> {
  const { plan, cookie } = await planAs(app);
  const created = await app.request(
    '/api/journeys',
    postJson({ planId: plan.planId, itineraryId: plan.recommendedId }, cookie),
  );
  const journey = journeySchema.parse(await created.json());
  const other = plan.itineraries.find((itinerary) => itinerary.id !== plan.recommendedId);
  if (other === undefined) throw new Error('the plan needs two itineraries');
  const alternatives: Alternative[] = [
    { id: 'free', itinerary: other, recommended: true, why: 'Leaves earlier.', price: null },
    {
      id: 'paid',
      itinerary: other,
      recommended: false,
      why: 'Taxi.',
      price: { amountMinor: 4_500, currency: 'USD' },
    },
  ];
  await db.transaction((tx) =>
    journeyStore.update(tx, journey.id, 1, { alternatives }, clock.now()),
  );
  return { journey, cookie };
}

const apply = (id: string, alternative: string, cookie: string) =>
  app.request(`/api/journeys/${id}/alternatives/${alternative}/apply`, postJson({}, cookie));

const codeOf = async (response: Response) => apiErrorSchema.parse(await response.json()).error.code;

describe('taking an alternative', () => {
  it('switches to a free alternative at once and records why', async () => {
    const { journey, cookie } = await journeyWithAlternatives();
    const response = await apply(journey.id, 'free', cookie);
    expect(response.status).toBe(200);
    const switched = journeySchema.parse(await response.json());
    expect(switched.itinerary.id).not.toBe(journey.itinerary.id);
    expect(switched).toMatchObject({
      alternatives: [],
      watch: { status: 'unknown', projectedArriveAt: null },
    });
    expect(switched.watch.evidence).toBe('Switched to the alternative you chose.');
    const events = await db.query({
      sql: 'SELECT kind, detail FROM journey_events WHERE journey_id = ? ORDER BY id',
      args: [journey.id],
    });
    expect(events.rows.at(-1)).toMatchObject({
      kind: 'alternative-chosen',
      detail: JSON.stringify({ alternativeId: 'free' }),
    });
  });

  it('refuses a paid alternative: only a confirmed payment applies it', async () => {
    const { journey, cookie } = await journeyWithAlternatives();
    const response = await apply(journey.id, 'paid', cookie);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe('conflict');
    expect((await journeyStore.get(db, journey.id))?.journey.itinerary).toEqual(journey.itinerary);
  });

  it('answers 404 to another traveller and to an alternative not on offer', async () => {
    const { journey, cookie } = await journeyWithAlternatives();
    const stranger = await planAs(app);
    expect((await apply(journey.id, 'free', stranger.cookie)).status).toBe(404);
    expect((await apply(journey.id, 'nope', cookie)).status).toBe(404);
  });

  it('refuses an alternative of a journey that is no longer watched', async () => {
    const { journey, cookie } = await journeyWithAlternatives();
    await app.request(`/api/journeys/${journey.id}`, { method: 'DELETE', headers: { cookie } });
    const response = await apply(journey.id, 'free', cookie);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe('conflict');
  });
});

describe('paying for an alternative while the journey is cancelled', () => {
  /** A payment for the paid alternative, approved by the buyer, with PayPal in memory. */
  async function approvedPayment(paypal: FakePayPal) {
    const { journey, cookie } = await journeyWithAlternatives();
    const stored = await journeyStore.get(db, journey.id);
    if (stored === undefined) throw new Error('the journey was not stored');
    const ctx: PaymentContext = {
      db,
      clock,
      logger: memoryLogger().logger,
      paypal,
      catalog: journeyPurchases({ db, clock }),
      source: 'api',
      write: (work) => db.transaction(work),
    };
    const purpose = {
      kind: 'journey-alternative' as const,
      journeyId: journey.id,
      alternativeId: 'paid',
    };
    const started = await startPayment(ctx, stored.travellerId, purpose);
    if (!started.ok) throw new Error(started.message);
    paypal.approve(started.payment.paypalOrderId ?? '');
    const cancel = () =>
      app.request(`/api/journeys/${journey.id}`, { method: 'DELETE', headers: { cookie } });
    return { journey, ctx, payment: started.payment, cancel };
  }

  it('refunds a capture that lands after the cancellation and leaves the journey as it was', async () => {
    const paypal = fakePayPal();
    const { journey, ctx, payment, cancel } = await approvedPayment(paypal);
    const capture = paypal.captureOrder.bind(paypal);
    // The traveller cancels while the capture is on its way to PayPal.
    paypal.captureOrder = async (orderId, requestId) => {
      expect((await cancel()).status).toBe(204);
      return capture(orderId, requestId);
    };
    const outcome = await confirmPayment(ctx, payment);
    expect(outcome.ok).toBe(false);
    expect(outcome.payment?.status).toBe('refunded');
    expect(outcome.payment?.detail).toMatch(/no longer being watched/);
    expect(paypal.order(payment.paypalOrderId ?? '')?.refunds).toHaveLength(1);
    const after = await journeyStore.get(db, journey.id);
    expect(after?.journey.state).toBe('cancelled');
    expect(after?.journey.itinerary).toEqual(journey.itinerary);
    expect(after?.journey.alternatives.map((alternative) => alternative.id)).toEqual([
      'free',
      'paid',
    ]);
  });

  it('applies a capture confirmed before the cancellation, which then cancels the new itinerary', async () => {
    const paypal = fakePayPal();
    const { journey, ctx, payment, cancel } = await approvedPayment(paypal);
    const outcome = await confirmPayment(ctx, payment);
    expect(outcome.ok && outcome.payment.status).toBe('captured');
    expect((await cancel()).status).toBe(204);
    const after = await journeyStore.get(db, journey.id);
    expect(after?.journey.state).toBe('cancelled');
    expect(after?.journey.itinerary.id).not.toBe(journey.itinerary.id);
    expect(paypal.order(payment.paypalOrderId ?? '')?.refunds).toHaveLength(0);
  });
});
