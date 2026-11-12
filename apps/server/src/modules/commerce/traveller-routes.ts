import { needRequestSchema, type Reservation } from '@moviq/contracts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import type { HoldOutcome } from '../payments/holds/hold-context.js';
import {
  commerceContext,
  holdContext,
  holdStatus,
  paymentsReason,
  type CommerceDependencies,
} from './context.js';
import { answerQuestion, createNeed, declineOffer } from './needs.js';
import { needStore, offerStore } from './offers-store.js';
import { orderStore } from './orders-store.js';
import { cancelOrder, confirmReservation, reserveOffer, type Refusal } from './reservations.js';
import { needView, offerView, orderView } from './views.js';
import { routePromotions } from './promotions.js';

type C = Context<TravellerBindings>;
type Routes = Hono<TravellerBindings>;

const answerSchema = z.strictObject({
  threadId: z.string().min(1),
  answer: z.string().min(1).max(40),
});
const reserveSchema = z.strictObject({ language: z.enum(['en', 'es']) });

/**
 * The traveller's side of commerce, mounted under `/api/commerce`: ask for something on the
 * way, see the rewards, reserve with PayPal, cancel and see "My orders". Every resource is
 * checked against the traveller of this device.
 */
export function travellerCommerceRoutes(deps: CommerceDependencies): Routes {
  const routes: Routes = new Hono<TravellerBindings>();
  routes.use(readTraveller({ db: deps.db, clock: deps.clock, secureCookies: deps.secureCookies }));
  routes.get('/journeys/:id/promotions', async (c) => {
    const owner = c.var.travellerId;
    if (owner === undefined) return notFound(c, 'journey');
    const result = await routePromotions(deps, owner, c.req.param('id'));
    return result === undefined ? notFound(c, 'journey') : c.json(result);
  });
  needRoutes(routes, deps);
  offerRoutes(routes, deps);
  orderRoutes(routes, deps);
  return routes;
}

/** Needs and the answers to a merchant's questions. */
function needRoutes(routes: Routes, deps: CommerceDependencies): void {
  const sessions = { db: deps.db, clock: deps.clock, secureCookies: deps.secureCookies };
  routes.post('/needs', ensureTraveller(sessions), async (c) => {
    const parsed = needRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success)
      return bad(c, 'Send the craving, an alias, your tastes, the route and the language.');
    const outcome = await createNeed(
      commerceContext(deps, c.var.logger),
      traveller(c),
      parsed.data,
    );
    if (!outcome.ok) return refusal(c, outcome);
    return c.json(await needView(deps, outcome.need), 201);
  });
  routes.get('/needs/:id', async (c) => {
    const need = await needStore.find(deps.db, c.req.param('id'));
    if (need === undefined || need.travellerId !== c.var.travellerId) return notFound(c, 'need');
    return c.json(await needView(deps, need));
  });
  routes.post('/needs/:id/answers', async (c) => {
    const need = await needStore.find(deps.db, c.req.param('id'));
    if (need === undefined || need.travellerId !== c.var.travellerId) return notFound(c, 'need');
    const parsed = answerSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return bad(c, 'Send the conversation and the chosen answer.');
    const { threadId, answer } = parsed.data;
    const outcome = await answerQuestion(
      commerceContext(deps, c.var.logger),
      need,
      threadId,
      answer,
    );
    if (!outcome.ok) return refusal(c, outcome);
    return c.json(await needView(deps, need));
  });
}

/** Declining, reserving (the PayPal order) and confirming (the authorization) an offer. */
function offerRoutes(routes: Routes, deps: CommerceDependencies): void {
  routes.post('/offers/:id/decline', async (c) => {
    const offer = await offerStore.find(deps.db, c.req.param('id'));
    if (offer === undefined || offer.travellerId !== c.var.travellerId) return notFound(c, 'offer');
    if (!(await declineOffer(commerceContext(deps, c.var.logger), offer))) {
      return c.json(errorBody(c, 'conflict', 'This offer can no longer be declined.'), 409);
    }
    return c.json(await offerView(deps, { ...offer, status: 'declined' }));
  });
  routes.post('/offers/:id/reserve', async (c) => {
    const ctx = holdContext(deps, c.var.logger);
    if (ctx === undefined || c.var.travellerId === undefined) return unavailable(c, deps);
    const parsed = reserveSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success)
      return bad(c, 'Send only the language of the PayPal window: the server sets the price.');
    const input = { travellerId: c.var.travellerId, offerId: c.req.param('id'), ...parsed.data };
    const outcome = await reserveOffer(ctx, input);
    if (!outcome.ok) return refusal(c, outcome);
    const { id, paypalOrderId, amount, status } = outcome.hold;
    if (paypalOrderId === null)
      return c.json(errorBody(c, 'internal', 'PayPal has not opened it yet.'), 503);
    const reservation: Reservation = { holdId: id, paypalOrderId, amount, status };
    return c.json(reservation, 201);
  });
  routes.post('/offers/:id/confirm', async (c) => {
    const ctx = holdContext(deps, c.var.logger);
    if (ctx === undefined || c.var.travellerId === undefined) return unavailable(c, deps);
    const input = { travellerId: c.var.travellerId, offerId: c.req.param('id') };
    const outcome = await confirmReservation(ctx, input);
    if (!outcome.ok) return refusal(c, outcome);
    const order = await orderStore.ofHold(deps.db, outcome.hold.id);
    const view = order === undefined ? undefined : await orderView(secretDeps(deps), order);
    return c.json(view ?? { status: outcome.hold.status }, holdStatus(outcome));
  });
}

/** "My orders", one order with its signed code, and cancelling it. */
function orderRoutes(routes: Routes, deps: CommerceDependencies): void {
  routes.get('/orders', async (c) => {
    const id = c.var.travellerId;
    const orders = id === undefined ? [] : await orderStore.ofTraveller(deps.db, id);
    const views = await Promise.all(orders.map((order) => orderView(secretDeps(deps), order)));
    return c.json({ orders: views.filter((view) => view !== undefined) });
  });
  routes.get('/orders/:id', async (c) => {
    const order = await orderStore.find(deps.db, c.req.param('id'));
    if (order === undefined) return notFound(c, 'order');
    if (order.travellerId !== c.var.travellerId) return notYours(c);
    return c.json(await orderView(secretDeps(deps), order));
  });
  routes.post('/orders/:id/cancel', async (c) => {
    const order = await orderStore.find(deps.db, c.req.param('id'));
    if (order === undefined) return notFound(c, 'order');
    if (order.travellerId !== c.var.travellerId) return notYours(c);
    const ctx = holdContext(deps, c.var.logger);
    if (ctx === undefined) return unavailable(c, deps);
    const outcome = await cancelOrder(ctx, order);
    if (!outcome.ok) return refusal(c, outcome);
    const latest = (await orderStore.find(deps.db, order.id)) ?? order;
    return c.json(await orderView(secretDeps(deps), latest), holdStatus(outcome));
  });
}

const secretDeps = (deps: CommerceDependencies) => ({
  db: deps.db,
  clock: deps.clock,
  secret: deps.settings.codeSecret,
});

function traveller(c: C): string {
  const id = c.var.travellerId;
  if (id === undefined) throw new Error('ensureTraveller left no traveller');
  return id;
}

const bad = (c: C, message: string) => c.json(errorBody(c, 'bad_request', message), 400);
const notFound = (c: C, what: string) =>
  c.json(errorBody(c, 'not_found', `There is no ${what} with that id.`), 404);
const notYours = (c: C) => c.json(errorBody(c, 'forbidden', 'This order is not yours.'), 403);
const unavailable = (c: C, deps: CommerceDependencies) =>
  c.json(errorBody(c, 'conflict', paymentsReason(deps)), 409);

/** A refusal of the commerce rules (404 or 409), or of a hold step (409, or 503 for PayPal). */
function refusal(c: C, outcome: Refusal | Exclude<HoldOutcome, { ok: true }>) {
  if ('status' in outcome) {
    return c.json(
      errorBody(c, outcome.status === 404 ? 'not_found' : 'conflict', outcome.message),
      outcome.status,
    );
  }
  return outcome.reason === 'unavailable'
    ? c.json(errorBody(c, 'internal', outcome.message), 503)
    : c.json(errorBody(c, 'conflict', outcome.message), 409);
}
