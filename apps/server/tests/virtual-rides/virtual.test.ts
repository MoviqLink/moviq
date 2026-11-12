import { Hono } from 'hono';
import {
  liveVehiclesResponseSchema,
  needViewSchema,
  reservationSchema,
  virtualRideSchema,
} from '@moviq/contracts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../src/infrastructure/http/errors.js';
import { merchantRoutes } from '../../src/modules/commerce/merchant-routes.js';
import { travellerCommerceRoutes } from '../../src/modules/commerce/traveller-routes.js';
import { merchantStore } from '../../src/modules/commerce/merchants.js';
import { commercePurchases } from '../../src/modules/commerce/hold-purchases.js';
import type { VirtualBusReading } from '../../src/modules/live/virtual-bus.js';
import { virtualRideRoutes } from '../../src/modules/virtual-rides/routes.js';
import { fakeGeocoder, fakePlanner } from '../assistant/doubles.js';
import { memoryLogger } from '../support/memory-logger.js';
import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';
import { browser, commerceWorld, TASTE, type CommerceWorld } from '../commerce/support/commerce.js';

let world: CommerceWorld;
let app: Hono<AppBindings>;
let reading: VirtualBusReading | null;
let planner: ReturnType<typeof fakePlanner>;
beforeEach(async () => {
  world = await commerceWorld();
  const capture = liveVehiclesResponseSchema.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../../web/tests/explore/fixtures/live-city.json', import.meta.url),
        ),
        'utf8',
      ),
    ),
  );
  const vehicle = capture.vehicles.find((item) => item.mode === 'bus');
  const source = capture.sources.find((item) => item.provenance.sourceId === vehicle?.sourceId);
  const merchant = await merchantStore.find(world.db, 'demo-tsuki-ramen-house');
  if (vehicle === undefined || source === undefined || merchant === undefined)
    throw new Error('Missing test data');
  const at = new Date(world.clock.now().getTime() + 60 * 60_000).toISOString();
  reading = {
    tripId: 'trip-1',
    vehicle: {
      ...vehicle,
      position: { ...vehicle.position, basis: 'gps', dataTime: world.clock.now().toISOString() },
    },
    source: { ...source, provenance: { ...source.provenance, state: 'healthy' } },
    sources: [source],
    stops: [
      {
        id: merchant.summary.stop.id,
        name: merchant.summary.stop.name,
        lat: merchant.summary.lat,
        lon: merchant.summary.lon,
        arrival: at,
        departure: at,
      },
    ],
  };
  planner = fakePlanner();
  app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/commerce', travellerCommerceRoutes(world.deps));
  app.route('/api/merchant', merchantRoutes(world.deps));
  app.route(
    '/api/virtual',
    virtualRideRoutes({
      db: world.db,
      clock: world.clock,
      secureCookies: false,
      commerce: world.deps,
      planner,
      geocoder: fakeGeocoder({}),
      readVehicle: () => Promise.resolve(reading),
    }),
  );
  app.onError(unexpectedError);
});
afterEach(async () => {
  await world.temp.dispose();
});

it('keeps invitations owned, expiring and tied to a fresh bus; confirms a feasible held reservation once', async () => {
  const rider = browser(app);
  const stranger = browser(app);
  if (reading === null) throw new Error('Missing bus');
  const made = await rider.post('/api/virtual/rides', { vehicleId: reading.vehicle.id });
  expect(made.status).toBe(201);
  const ride = virtualRideSchema.parse(made.body);
  const invitation = ride.stops[0]?.suggestions[0];
  if (invitation === undefined) throw new Error('Missing invitation');
  expect((await stranger.get(`/api/virtual/rides/${ride.id}`)).status).toBe(404);
  const refreshed = virtualRideSchema.parse(
    (await rider.get(`/api/virtual/rides/${ride.id}`)).body,
  );
  expect(refreshed.stops[0]?.suggestions[0]?.invitationId).toBe(invitation.invitationId);
  expect(refreshed.stops[0]?.suggestions[0]?.expiresAt).toBe(invitation.expiresAt);
  const request = {
    invitationId: invitation.invitationId,
    alias: 'Mia',
    taste: TASTE,
    language: 'es',
  };
  const answers = await Promise.all([
    rider.post(`/api/virtual/rides/${ride.id}/needs`, request),
    rider.post(`/api/virtual/rides/${ride.id}/needs`, request),
  ]);
  const accepted = answers.find((answer) => answer.status === 201);
  if (accepted === undefined) throw new Error('No invitation accepted');
  const need = needViewSchema.parse(accepted.body);
  expect(answers.every((answer) => answer.status === 201 || answer.status === 409)).toBe(true);
  const count = await world.db.query('SELECT COUNT(*) AS n FROM virtual_ride_needs');
  expect(count.rows[0]?.['n']).toBe(1);
  const offer = need.offers[0];
  if (offer === undefined) throw new Error('Missing offer');
  expect(Date.parse(offer.expiresAt)).toBeLessThanOrEqual(Date.parse(invitation.expiresAt));
  expect(
    (await rider.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'es' })).status,
  ).toBe(409);
  const origin = { label: 'Public station', lat: 40.8, lon: -73.95, kind: 'station', stopId: '1' };
  expect(
    (await rider.post(`/api/virtual/rides/${ride.id}/estimate`, { offerId: offer.id, origin }))
      .status,
  ).toBe(200);
  const realPlan = planner.plan.bind(planner);
  planner.plan = async (...args) => ({
    ...(await realPlan(...args)),
    itineraries: [],
    recommendedId: null,
  });
  expect(
    (await rider.post(`/api/virtual/rides/${ride.id}/estimate`, { offerId: offer.id, origin }))
      .status,
  ).toBe(409);
  expect(
    (await rider.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'es' })).status,
  ).toBe(409);
  planner.plan = realPlan;
  expect(
    (await rider.post(`/api/virtual/rides/${ride.id}/estimate`, { offerId: offer.id, origin }))
      .status,
  ).toBe(200);
  const held = reservationSchema.parse(
    (await rider.post(`/api/commerce/offers/${offer.id}/reserve`, { language: 'es' })).body,
  );
  expect(
    (await rider.post(`/api/virtual/rides/${ride.id}/journey`, { offerId: offer.id })).status,
  ).toBe(409);
  await world.db.execute({
    sql: `UPDATE virtual_ride_needs SET validation_depart_at = ? WHERE ride_id = ?`,
    args: [world.clock.now().toISOString(), ride.id],
  });
  await expect(
    world.db.transaction((tx) =>
      commercePurchases({ clock: world.clock }).authorized(
        { kind: 'merchant-offer', offerId: offer.id },
        held.holdId,
        tx,
      ),
    ),
  ).rejects.toThrow(/route/);
  expect((await world.db.query('SELECT COUNT(*) AS n FROM commerce_orders')).rows[0]?.['n']).toBe(
    0,
  );
  await rider.post(`/api/virtual/rides/${ride.id}/estimate`, { offerId: offer.id, origin });

  world.paypal.approve(held.paypalOrderId);
  expect((await rider.post(`/api/commerce/offers/${offer.id}/confirm`)).status).toBe(200);
  const first = await rider.post(`/api/virtual/rides/${ride.id}/journey`, { offerId: offer.id });
  expect(first.status).toBe(200);
  const again = await rider.post(`/api/virtual/rides/${ride.id}/journey`, { offerId: offer.id });
  expect(again.body).toEqual(first.body);
  const business = browser(app);
  await business.post('/api/merchant/session', {
    token: MERCHANT_TEST_TOKEN,
    merchantId: invitation.merchant.id,
  });
  expect((await business.get('/api/virtual/partner/metrics')).body).toMatchObject({
    visits: 1,
    reserved: 1,
    visitedReal: 1,
  });
  reading = null;
  const lost = virtualRideSchema.parse((await rider.get(`/api/virtual/rides/${ride.id}`)).body);
  expect(lost.status).toBe('lost');
  expect(lost.stops).toEqual([]);
  expect(lost.vehicle.position.dataTime).toBe(ride.vehicle.position.dataTime);
});

it('does not extend an expired invitation and creates no need from a preview or lost GPS', async () => {
  const rider = browser(app);
  if (reading === null) throw new Error('Missing bus');
  const ride = virtualRideSchema.parse(
    (await rider.post('/api/virtual/rides', { vehicleId: reading.vehicle.id })).body,
  );
  const inv = ride.stops[0]?.suggestions[0];
  if (inv === undefined) throw new Error('Missing invitation');
  const counts = await world.db.query('SELECT COUNT(*) AS n FROM virtual_ride_needs');
  expect(counts.rows[0]?.['n']).toBe(0);
  world.clock.advance(6 * 60_000);
  reading = {
    ...reading,
    vehicle: {
      ...reading.vehicle,
      position: { ...reading.vehicle.position, dataTime: world.clock.now().toISOString() },
    },
  };
  const later = virtualRideSchema.parse((await rider.get(`/api/virtual/rides/${ride.id}`)).body);
  expect(later.stops[0]?.suggestions[0]).toMatchObject({
    invitationId: inv.invitationId,
    expiresAt: inv.expiresAt,
    status: 'expired',
  });
  expect(
    (
      await rider.post(`/api/virtual/rides/${ride.id}/needs`, {
        invitationId: inv.invitationId,
        alias: 'Mia',
        taste: TASTE,
        language: 'es',
      })
    ).status,
  ).toBe(409);
  reading = null;
  const lost = virtualRideSchema.parse((await rider.get(`/api/virtual/rides/${ride.id}`)).body);
  expect(lost.status).toBe('lost');
  expect(lost.stops).toEqual([]);
});

it('ends the virtual ride when the same bus starts another trip', async () => {
  const rider = browser(app);
  if (reading === null) throw new Error('Missing bus');
  const ride = virtualRideSchema.parse(
    (await rider.post('/api/virtual/rides', { vehicleId: reading.vehicle.id })).body,
  );
  reading = {
    ...reading,
    tripId: 'next-trip',
    vehicle: {
      ...reading.vehicle,
      position: {
        ...reading.vehicle.position,
        dataTime: new Date(world.clock.now().getTime() - 1000).toISOString(),
      },
    },
  };
  expect(
    virtualRideSchema.parse((await rider.get(`/api/virtual/rides/${ride.id}`)).body).status,
  ).toBe('following');
  reading = {
    ...reading,
    vehicle: {
      ...reading.vehicle,
      position: { ...reading.vehicle.position, dataTime: world.clock.now().toISOString() },
    },
  };
  const ended = virtualRideSchema.parse((await rider.get(`/api/virtual/rides/${ride.id}`)).body);
  expect(ended.status).toBe('ended');
  expect(ended.stops).toEqual([]);
  expect((await rider.get('/api/virtual/rides/current')).body).toEqual({ ride: null });
});
