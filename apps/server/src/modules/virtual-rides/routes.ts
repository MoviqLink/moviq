import {
  virtualCreateSchema,
  virtualEstimateRequestSchema,
  virtualJourneyRequestSchema,
  virtualNeedSchema,
} from '@moviq/contracts';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import { requireMerchant, type MerchantBindings } from '../commerce/merchant-sessions.js';
import type { CommerceDependencies } from '../commerce/context.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import type { Geocoder, JourneyPlanner } from '../journeys/ports.js';
import type { VirtualBusReading } from '../live/virtual-bus.js';
import { estimateToOffer } from './estimate.js';
import { journeyFromReservation } from './journey.js';
import { rideView } from './offers.js';
import { requestInvitation } from './request.js';
import { createRide, currentRide, findRide, refreshRide } from './store.js';

export interface VirtualRideDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  readonly commerce: CommerceDependencies;
  readonly planner: JourneyPlanner;
  readonly geocoder: Geocoder;
  readonly readVehicle: (id: string) => Promise<VirtualBusReading | null>;
}
/** Never turn a stale, future or interpolated point into a live virtual GPS ride. */
export async function live(
  deps: VirtualRideDependencies,
  id: string,
): Promise<VirtualBusReading | null> {
  try {
    const found = await deps.readVehicle(id);
    if (
      found?.vehicle.id !== id ||
      found.vehicle.mode !== 'bus' ||
      found.vehicle.position.basis !== 'gps'
    )
      return null;
    const age = deps.clock.now().getTime() - Date.parse(found.vehicle.position.dataTime);
    return Number.isFinite(age) &&
      age >= -30_000 &&
      age <= 120_000 &&
      found.source.provenance.state === 'healthy'
      ? found
      : null;
  } catch {
    return null;
  }
}

/** Session-owned virtual rides, short-lived invitations and a route after a confirmed hold. */
export function virtualRideRoutes(deps: VirtualRideDependencies): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  const traveller = new Hono<TravellerBindings>();
  const sessions = { db: deps.db, clock: deps.clock, secureCookies: deps.secureCookies };
  traveller.use(readTraveller(sessions));
  traveller.get('/places', async (c) => {
    const query = c.req.query('q')?.trim() ?? '';
    if (query.length < 2 || query.length > 120)
      return c.json(errorBody(c, 'bad_request', 'Enter a place.'), 400);
    const result = await deps.geocoder.search(query, c.req.raw.signal);
    if (!result.ok && result.code !== 'no-match')
      return c.json(errorBody(c, 'unavailable', 'Place search is unavailable.'), 503);
    return c.json({ places: result.ok ? result.value : [] });
  });
  traveller.get('/rides/current', async (c) => {
    const owner = c.var.travellerId;
    const row = owner === undefined ? undefined : await currentRide(deps.db, owner);
    if (row === undefined) return c.json({ ride: null });
    const current = await refreshRide(
      deps.db,
      row,
      await live(deps, row.vehicle_id),
      deps.clock.now(),
    );
    return c.json({
      ride:
        current === undefined || current.state === 'ended'
          ? null
          : await rideView(deps.commerce, current),
    });
  });
  traveller.post('/rides', ensureTraveller(sessions), async (c) => {
    const body = virtualCreateSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json(errorBody(c, 'bad_request', 'Choose a live bus.'), 400);
    const owner = c.var.travellerId;
    if (owner === undefined) throw new Error('Missing traveller.');
    const reading = await live(deps, body.data.vehicleId);
    if (reading === null)
      return c.json(errorBody(c, 'conflict', 'That bus cannot be followed right now.'), 409);
    const id = await createRide(deps.db, owner, reading, deps.clock.now());
    if (id === null)
      return c.json(errorBody(c, 'conflict', 'Leave the current virtual ride first.'), 409);
    const row = await findRide(deps.db, owner, id);
    if (row === undefined) throw new Error('Ride not created.');
    return c.json(await rideView(deps.commerce, row), 201);
  });
  traveller.get('/rides/:id', async (c) => {
    const owner = c.var.travellerId;
    const row = owner === undefined ? undefined : await findRide(deps.db, owner, c.req.param('id'));
    if (row === undefined) return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    const current = await refreshRide(
      deps.db,
      row,
      row.state === 'ended' ? null : await live(deps, row.vehicle_id),
      deps.clock.now(),
    );
    if (current === undefined)
      return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    return c.json(await rideView(deps.commerce, current));
  });
  traveller.delete('/rides/:id', async (c) => {
    const owner = c.var.travellerId;
    if (owner === undefined)
      return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    const result = await deps.db.execute({
      sql: "UPDATE virtual_rides SET state = 'ended' WHERE id = ? AND traveller_id = ? AND state != 'ended'",
      args: [c.req.param('id'), owner],
    });
    return result.rowsAffected === 0
      ? c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404)
      : c.body(null, 204);
  });
  registerActions(traveller, deps);
  app.route('/', traveller);
  app.route('/', partnerRoutes(deps));
  return app;
}

function registerActions(traveller: Hono<TravellerBindings>, deps: VirtualRideDependencies): void {
  traveller.post('/rides/:id/needs', async (c) => {
    const body = virtualNeedSchema.safeParse(await c.req.json().catch(() => undefined));
    const owner = c.var.travellerId;
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose an invitation and your preferences.'), 400);
    if (owner === undefined)
      return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    const answer = await requestInvitation(deps, owner, c.req.param('id'), body.data, c.var.logger);
    return answer === null
      ? c.json(errorBody(c, 'conflict', 'Invitation expired or unavailable.'), 409)
      : c.json(answer, 201);
  });
  traveller.post('/rides/:id/estimate', async (c) => {
    const body = virtualEstimateRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    const owner = c.var.travellerId;
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose an offer and origin.'), 400);
    if (owner === undefined)
      return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    const plan = await estimateToOffer(
      deps,
      owner,
      c.req.param('id'),
      body.data.offerId,
      body.data.origin,
      c.req.raw.signal,
    );
    return plan === null
      ? c.json(errorBody(c, 'conflict', 'No feasible route is available before pickup.'), 409)
      : c.json({ plan });
  });
  traveller.post('/rides/:id/journey', async (c) => {
    const body = virtualJourneyRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    const owner = c.var.travellerId;
    if (!body.success) return c.json(errorBody(c, 'bad_request', 'Choose a reserved offer.'), 400);
    if (owner === undefined)
      return c.json(errorBody(c, 'not_found', 'Virtual ride not found.'), 404);
    const journey = await journeyFromReservation(
      deps,
      owner,
      c.req.param('id'),
      body.data.offerId,
      c.req.raw.signal,
    );
    return journey === null
      ? c.json(
          errorBody(c, 'conflict', 'The reservation is held, but no trip can be started now.'),
          409,
        )
      : c.json({ journey });
  });
}

function partnerRoutes(deps: VirtualRideDependencies): Hono<MerchantBindings> {
  const partner = new Hono<MerchantBindings>();
  partner.use('/partner/metrics', requireMerchant(deps.commerce));
  partner.get('/partner/metrics', async (c) => {
    const result = await deps.db.query({
      sql: `SELECT COUNT(DISTINCT v.need_id) AS visits,
      COUNT(DISTINCT CASE WHEN o.status != 'cancelled' THEN o.id END) AS reserved,
      COUNT(DISTINCT CASE WHEN r.journey_id IS NOT NULL AND r.journey_offer_id = f.id THEN
      r.journey_id END) AS visitedReal
      FROM virtual_ride_needs v JOIN virtual_rides r ON r.id = v.ride_id
      LEFT JOIN commerce_threads t ON t.need_id = v.need_id LEFT JOIN commerce_offers f ON f.thread_id = t.id
      LEFT JOIN commerce_orders o ON o.offer_id = f.id WHERE v.merchant_id = ?`,
      args: [c.var.merchantId],
    });
    return c.json(
      z
        .object({ visits: z.number(), reserved: z.number(), visitedReal: z.number() })
        .parse(result.rows[0]),
    );
  });
  return partner;
}
