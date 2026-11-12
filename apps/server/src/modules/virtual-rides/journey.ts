import { randomUUID } from 'node:crypto';
import {
  placeSchema,
  toInstant,
  type Journey,
  type Place,
  type PlanRequest,
} from '@moviq/contracts';
import type { Database } from '../../infrastructure/database/database.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import { merchantStore } from '../commerce/merchants.js';
import { offerStore } from '../commerce/offers-store.js';
import { journeyStore } from '../journeys/journey-store.js';
import type { JourneyPlanner } from '../journeys/ports.js';

/** One journey per ride; the lease fences a delayed planner and its commit. */
export async function journeyFromReservation(
  deps: { db: Database; clock: Clock; planner: JourneyPlanner },
  owner: string,
  rideId: string,
  offerId: string,
  signal?: AbortSignal,
): Promise<Journey | null> {
  const row = await deps.db.query({
    sql: `SELECT r.journey_id, r.journey_offer_id, v.origin_json, v.validation_offer_id FROM virtual_rides r
    JOIN virtual_ride_needs v ON v.ride_id = r.id JOIN commerce_threads t ON t.need_id = v.need_id
    JOIN commerce_offers f ON f.thread_id = t.id JOIN commerce_orders o ON o.offer_id = f.id
    JOIN payment_holds h ON h.id = o.hold_id
    WHERE r.id = ? AND r.traveller_id = ? AND f.id = ? AND f.traveller_id = ?
      AND o.traveller_id = ? AND o.status IN ('reserved','preparing','ready') AND h.status = 'authorized'`,
    args: [rideId, owner, offerId, owner, owner],
  });
  if (row.rows[0] === undefined) return null;
  const originRaw = row.rows[0]['origin_json'];
  if (typeof originRaw !== 'string' || row.rows[0]['validation_offer_id'] !== offerId) return null;
  const origin = placeSchema.parse(JSON.parse(originRaw));
  const linked = row.rows[0]['journey_id'];
  if (typeof linked === 'string') {
    if (row.rows[0]['journey_offer_id'] !== offerId) return null;
    return (await journeyStore.get(deps.db, linked))?.journey ?? null;
  }
  const token = randomUUID();
  const now = deps.clock.now();
  const lock = await deps.db.execute({
    sql: `UPDATE virtual_rides SET plan_token = ?, plan_locked_until = ?
    WHERE id = ? AND traveller_id = ? AND journey_id IS NULL
      AND (plan_locked_until IS NULL OR plan_locked_until <= ?)`,
    args: [token, toInstant(new Date(now.getTime() + 120_000)), rideId, owner, toInstant(now)],
  });
  if (lock.rowsAffected !== 1) return null;
  try {
    const journey = await buildJourney(deps, owner, offerId, origin, signal);
    if (journey === null) return null;
    return await commitJourney(deps.db, owner, rideId, offerId, token, journey);
  } finally {
    await deps.db.execute({
      sql: 'UPDATE virtual_rides SET plan_token = NULL, plan_locked_until = NULL WHERE id = ? AND plan_token = ?',
      args: [rideId, token],
    });
  }
}

async function buildJourney(
  deps: { db: Database; clock: Clock; planner: JourneyPlanner },
  owner: string,
  offerId: string,
  origin: Place,
  signal?: AbortSignal,
): Promise<Journey | null> {
  const offer = await offerStore.find(deps.db, offerId);
  const merchant =
    offer === undefined ? undefined : await merchantStore.find(deps.db, offer.merchantId);
  if (offer === undefined || merchant === undefined) return null;
  const request: PlanRequest = {
    origin,
    destination: {
      label: `${merchant.summary.name} (demo)`,
      lat: merchant.summary.lat,
      lon: merchant.summary.lon,
      kind: 'address',
      stopId: null,
    },
    arriveBy: offer.pickupAt,
    flight: null,
    preferences: {
      maxWalkMinutes: 15,
      stepFree: false,
      modes: ['walk', 'subway', 'bus', 'rail', 'ferry'],
      spareMinutes: 5,
    },
  };
  const plan = await deps.planner.plan(request, owner, signal).catch((error: unknown) => {
    if (signal?.aborted === true) throw error;
    return null;
  });
  if (plan === null) return null;
  const itinerary = plan.itineraries.find((candidate) => candidate.id === plan.recommendedId);
  if (
    itinerary === undefined ||
    Date.parse(itinerary.arriveAt) > Date.parse(offer.pickupAt) ||
    Date.parse(itinerary.departAt) < deps.clock.now().getTime()
  )
    return null;
  const createdAt = toInstant(deps.clock.now());
  const journey: Journey = {
    id: randomUUID(),
    state: 'watching',
    request,
    itinerary,
    createdAt,
    watch: {
      status: 'unknown',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not checked yet.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
  return journey;
}

async function commitJourney(
  db: Database,
  owner: string,
  rideId: string,
  offerId: string,
  token: string,
  journey: Journey,
): Promise<Journey | null> {
  const { request, itinerary, createdAt } = journey;
  return db.transaction(async (tx) => {
    const held = await tx.execute({
      sql: `SELECT id FROM virtual_rides WHERE id = ? AND traveller_id = ?
        AND plan_token = ? AND plan_locked_until > ? AND journey_id IS NULL`,
      args: [rideId, owner, token, createdAt],
    });
    if (held.rows.length === 0) return null;
    const order = await tx.execute({
      sql: `SELECT o.id FROM commerce_orders o JOIN payment_holds h ON h.id = o.hold_id
        WHERE o.offer_id = ? AND o.traveller_id = ? AND o.status IN ('reserved','preparing','ready')
          AND h.status = 'authorized'`,
      args: [offerId, owner],
    });
    if (order.rows.length === 0) return null;
    await tx.execute({
      sql: `INSERT INTO journeys (id, traveller_id, state, request, itinerary, watch,
        incidents, alternatives, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [
        journey.id,
        owner,
        journey.state,
        JSON.stringify(request),
        JSON.stringify(itinerary),
        JSON.stringify(journey.watch),
        '[]',
        '[]',
        createdAt,
        createdAt,
      ],
    });
    await journeyStore.addEvent(
      tx,
      journey.id,
      'created',
      { itineraryId: itinerary.id },
      new Date(createdAt),
    );
    await tx.execute({
      sql: `UPDATE virtual_rides SET journey_id = ?, journey_offer_id = ?
        WHERE id = ? AND plan_token = ?`,
      args: [journey.id, offerId, rideId, token],
    });
    return journey;
  });
}
