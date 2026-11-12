import { createTicketIntentSchema, ticketAutopaySwitchSchema } from '@moviq/contracts';
import { Hono } from 'hono';

import type { AppConfig } from '../../config/config.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import type { TicketAutopayService } from './autopay.js';
import { ticketCatalog } from './catalog.js';
import { demoRoutes } from './demo-routes.js';
import { createIntent, wallet } from './store.js';

export interface TicketRoutesDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  readonly sandbox: boolean;
  readonly demoEnabled?: boolean;
  readonly buyerEnabled?: boolean;
  readonly buyer?: AppConfig['paypalDemoBuyer'];
  /** The assistant's way to pay; without it nothing can be connected. */
  readonly autopay?: TicketAutopayService;
}

/** Where PayPal's return lands in the web: the Agent screen says how it went. */
const RETURNED = { connected: '/#/agents?autopay=connected', failed: '/#/agents?autopay=failed' };
const NOT_CONNECTED = {
  available: false,
  enabled: true,
  connected: false,
  connectedAt: null,
  testBuyer: false,
};

/** Public catalogue, private wallet and sandbox-only demo sessions. */
export function ticketRoutes(deps: TicketRoutesDependencies): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  routes.get('/catalog', (c) => c.json(ticketCatalog()));
  const traveller = new Hono<TravellerBindings>();
  traveller.use(readTraveller(deps));
  traveller.get('/wallet', async (c) => c.json(await wallet(deps.db, c.var.travellerId)));
  traveller.post('/intents', async (c) => {
    if (!deps.sandbox)
      return c.json(errorBody(c, 'conflict', 'Ticket demonstrations require PayPal sandbox.'), 409);
    const body = createTicketIntentSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose a demonstration product.'), 400);
    await ensureTraveller(deps)(c, () => Promise.resolve());
    if (c.var.travellerId === undefined) throw new Error('No traveller session.');
    const intent = await createIntent(deps.db, deps.clock, c.var.travellerId, body.data.productId);
    return intent === undefined
      ? c.json(errorBody(c, 'not_found', 'No such demonstration product.'), 404)
      : c.json(intent, 201);
  });
  autopayRoutes(traveller, deps);
  // PayPal returns the browser here; the token it carries names the pending approval.
  routes.get('/autopay/return', async (c) => {
    const token = c.req.query('ba_token');
    const done =
      token !== undefined &&
      (await deps.autopay?.complete(token).catch((error: unknown) => {
        c.var.logger.warn('ticket autopay approval not completed', { error });
        return false;
      })) === true;
    return c.redirect(done ? RETURNED.connected : RETURNED.failed);
  });
  routes.get('/autopay/cancelled', (c) => c.redirect(RETURNED.failed));
  routes.route('/', traveller);
  routes.route('/demo', demoRoutes(deps));
  return routes;
}

/** The traveller's switch and the one approval in PayPal that lets the assistant pay. */
function autopayRoutes(traveller: Hono<TravellerBindings>, deps: TicketRoutesDependencies): void {
  const { autopay } = deps;
  const ensure = ensureTraveller(deps);
  traveller.get('/autopay', async (c) =>
    c.json(autopay === undefined ? NOT_CONNECTED : await autopay.status(c.var.travellerId)),
  );
  traveller.put('/autopay', async (c) => {
    const body = ticketAutopaySwitchSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Send enabled: true or false.'), 400);
    if (autopay === undefined) return c.json(NOT_CONNECTED);
    await ensure(c, () => Promise.resolve());
    if (c.var.travellerId === undefined) throw new Error('No traveller session.');
    return c.json(await autopay.setEnabled(c.var.travellerId, body.data.enabled));
  });
  traveller.post('/autopay', async (c) => {
    await ensure(c, () => Promise.resolve());
    if (c.var.travellerId === undefined) throw new Error('No traveller session.');
    const origin = c.req.header('origin') ?? new URL(c.req.url).origin;
    const started = await autopay?.begin(c.var.travellerId, origin);
    return started === undefined
      ? c.json(errorBody(c, 'conflict', 'PayPal sandbox is not set up on this server.'), 409)
      : c.json(started, 201);
  });
  traveller.delete('/autopay', async (c) => {
    if (autopay === undefined || c.var.travellerId === undefined) return c.json(NOT_CONNECTED);
    return c.json(await autopay.disconnect(c.var.travellerId, c.var.logger));
  });
}
