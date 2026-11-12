import { createPaymentRequestSchema } from '@moviq/contracts';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import type { PurchaseCatalog } from './catalog.js';
import type { Outcome, PaymentContext } from './context.js';
import { paymentLedger, toPayment, type PaymentRecord, type PaymentSource } from './ledger.js';
import { confirmPayment, startPayment } from './service.js';
import type { PaymentsSetup } from './setup.js';
import { handleWebhook, signatureHeaders } from './webhooks.js';

export interface PaymentsRouteDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  readonly catalog: PurchaseCatalog;
  readonly setup: PaymentsSetup;
}

/** Only the purpose: an amount or anything else sent by the client is refused, never used. */
const createRequestSchema = createPaymentRequestSchema.strict();

const WEBHOOK_MAX_BYTES = 64 * 1024;
const NOT_FOUND = 'There is no payment with that id.';

type PaymentsContext = Context<TravellerBindings>;

/** The payments API, mounted under `/api/payments`. */
export function paymentsRoutes(deps: PaymentsRouteDependencies): Hono<TravellerBindings> {
  const routes = new Hono<TravellerBindings>();
  const ensure = ensureTraveller(deps);
  routes.use(readTraveller(deps));

  routes.get('/config', (c) => c.json(deps.setup.available ? deps.setup.config : deps.setup));

  routes.post('/orders', async (c) => {
    const ctx = paymentContext(c, deps, 'api');
    if (ctx === undefined) return unavailableResponse(c, deps.setup);
    const parsed = createRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      return c.json(
        errorBody(
          c,
          'bad_request',
          'Send only the purpose of the payment: the server sets the price.',
        ),
        400,
      );
    }
    await ensure(c, () => Promise.resolve());
    const travellerId = c.var.travellerId;
    if (travellerId === undefined) throw new Error('ensureTraveller left no traveller');
    return respond(c, await startPayment(ctx, travellerId, parsed.data.purpose));
  });

  routes.get('/orders/:id', async (c) => {
    const payment = await ownedPayment(c, deps.db);
    const view = payment === undefined ? undefined : toPayment(payment);
    return view === undefined ? c.json(errorBody(c, 'not_found', NOT_FOUND), 404) : c.json(view);
  });

  routes.post('/orders/:id/confirm', async (c) => {
    const payment = await ownedPayment(c, deps.db);
    if (payment === undefined || payment.paypalOrderId === null)
      return c.json(errorBody(c, 'not_found', NOT_FOUND), 404);
    const ctx = paymentContext(c, deps, 'api');
    if (ctx === undefined) return unavailableResponse(c, deps.setup);
    return respond(c, await confirmPayment(ctx, payment));
  });

  routes.use('/webhooks', webhookSizeLimit);
  routes.post('/webhooks', async (c) => {
    const ctx = paymentContext(c, deps, 'webhook');
    const webhookId = deps.setup.available ? deps.setup.webhookId : undefined;
    if (ctx === undefined || webhookId === undefined) {
      return c.json(errorBody(c, 'not_found', 'PayPal notifications are not set up here.'), 404);
    }
    const result = await handleWebhook(ctx, {
      webhookId,
      headers: signatureHeaders((name) => c.req.header(name)),
      rawBody: await c.req.text(),
    });
    switch (result.kind) {
      case 'rejected':
        return c.json(errorBody(c, 'bad_request', result.message), 400);
      case 'retry':
        return c.json(errorBody(c, 'internal', result.message), 500);
      case 'processed':
      case 'duplicate':
      case 'unmatched':
        return c.json({ result: result.kind });
    }
  });
  return routes;
}

/** PayPal notifications are small; anything larger is refused before it is read. */
const webhookSizeLimit: MiddlewareHandler<TravellerBindings> = (c, next) =>
  bodyLimit({
    maxSize: WEBHOOK_MAX_BYTES,
    onError: () => c.json(errorBody(c, 'bad_request', 'This notification is too large.'), 400),
  })(c, next);

function paymentContext(
  c: PaymentsContext,
  deps: PaymentsRouteDependencies,
  source: PaymentSource,
): PaymentContext | undefined {
  if (!deps.setup.available) return undefined;
  return {
    db: deps.db,
    clock: deps.clock,
    logger: c.var.logger,
    paypal: deps.setup.paypal,
    catalog: deps.catalog,
    source,
    write: (work) => deps.db.transaction(work),
  };
}

/** The payment of this id if it belongs to this device's traveller; anyone else gets nothing. */
async function ownedPayment(c: PaymentsContext, db: Database): Promise<PaymentRecord | undefined> {
  const travellerId = c.var.travellerId;
  if (travellerId === undefined) return undefined;
  const payment = await paymentLedger.find(db, c.req.param('id') ?? '');
  return payment?.travellerId === travellerId ? payment : undefined;
}

function unavailableResponse(c: PaymentsContext, setup: PaymentsSetup) {
  const reason = setup.available ? 'PayPal is not available right now.' : setup.reason;
  return c.json(errorBody(c, 'conflict', reason), 409);
}

/**
 * A charged payment answers 200; one whose answer from PayPal is still unknown, 202 with its
 * state, so the client shows "confirming" and asks again; anything else, an error that says why.
 */
function respond(c: PaymentsContext, outcome: Outcome) {
  if (!outcome.ok) {
    return outcome.reason === 'unavailable'
      ? c.json(errorBody(c, 'internal', outcome.message), 500)
      : c.json(errorBody(c, 'conflict', outcome.message), 409);
  }
  const payment = toPayment(outcome.payment);
  if (payment === undefined) {
    return c.json(errorBody(c, 'internal', 'PayPal has not opened this payment yet.'), 500);
  }
  return c.json(payment, outcome.payment.status === 'unknown' ? 202 : 200);
}
