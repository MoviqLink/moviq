import { randomUUID } from 'node:crypto';
import { type Place, type PlanRequest, type PlanResponse } from '@moviq/contracts';
import type { Database } from '../../infrastructure/database/database.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import { merchantStore } from '../commerce/merchants.js';
import { offerClosed, offerStore } from '../commerce/offers-store.js';
import type { JourneyPlanner } from '../journeys/ports.js';

/** Builds only a real provider-backed route to the merchant, due by the promised pickup. */
export async function estimateToOffer(
  deps: { db: Database; clock: Clock; planner: JourneyPlanner },
  owner: string,
  rideId: string,
  offerId: string,
  origin: Place,
  signal?: AbortSignal,
): Promise<PlanResponse | null> {
  const linked = await deps.db.query({
    sql: `SELECT v.need_id FROM virtual_ride_needs v
    JOIN virtual_rides r ON r.id = v.ride_id JOIN commerce_threads t ON t.need_id = v.need_id
    JOIN commerce_offers o ON o.thread_id = t.id
    WHERE r.id = ? AND r.traveller_id = ? AND o.id = ? AND o.traveller_id = ?`,
    args: [rideId, owner, offerId, owner],
  });
  const needId = linked.rows[0]?.['need_id'];
  if (typeof needId !== 'string') return null;
  const offer = await offerStore.find(deps.db, offerId);
  if (offer === undefined || offerClosed(offer, deps.clock.now()) !== undefined) return null;
  const merchant = await merchantStore.find(deps.db, offer.merchantId);
  if (merchant === undefined) return null;
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
  const token = randomUUID();
  await deps.db.execute({
    sql: `UPDATE virtual_ride_needs SET estimate_token = ?, origin_json = NULL,
    validation_offer_id = NULL, validation_plan_id = NULL, validation_expires_at = NULL,
    validation_depart_at = NULL WHERE need_id = ? AND ride_id = ?`,
    args: [token, needId, rideId],
  });
  const plan = await deps.planner.plan(request, owner, signal).catch((error: unknown) => {
    if (signal?.aborted === true) throw error;
    return null;
  });
  if (plan === null) return null;
  const itinerary = plan.itineraries.find((candidate) => candidate.id === plan.recommendedId);
  const now = deps.clock.now();
  if (
    itinerary === undefined ||
    Date.parse(itinerary.arriveAt) > Date.parse(offer.pickupAt) ||
    Date.parse(itinerary.departAt) < now.getTime() ||
    offerClosed(offer, now) !== undefined
  )
    return null;
  const update = await deps.db.execute({
    sql: `UPDATE virtual_ride_needs SET origin_json = ?, validation_offer_id = ?,
    validation_plan_id = ?, validation_expires_at = ?, validation_depart_at = ? WHERE need_id = ?
    AND ride_id = ? AND estimate_token = ?`,
    args: [
      JSON.stringify(origin),
      offerId,
      plan.planId,
      offer.expiresAt,
      itinerary.departAt,
      needId,
      rideId,
      token,
    ],
  });
  return update.rowsAffected === 1 ? plan : null;
}
