import { createWalletTopUpSchema } from '@moviq/contracts';
import { Hono } from 'hono';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import type { TicketAutopayService } from '../tickets/autopay.js';
import { createTopUp, readWallet } from './store.js';

export interface WalletRouteDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  /** PayPal sandbox is set up: money can be added. */
  readonly sandbox: boolean;
  /** Adds money with the PayPal the traveller connected, with no PayPal window. */
  readonly autopay?: Pick<TicketAutopayService, 'addFunds'>;
}

/** The traveller's trip wallet, mounted under `/api/wallet`. */
export function walletRoutes(deps: WalletRouteDependencies): Hono<TravellerBindings> {
  const routes = new Hono<TravellerBindings>();
  routes.use(readTraveller(deps));
  routes.get('/', async (c) => c.json(await readWallet(deps.db, c.var.travellerId, deps.sandbox)));
  routes.post('/top-ups', async (c) => {
    if (!deps.sandbox)
      return c.json(errorBody(c, 'conflict', 'The trip wallet requires PayPal sandbox.'), 409);
    const body = createWalletTopUpSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose an amount between $5 and $500.'), 400);
    await ensureTraveller(deps)(c, () => Promise.resolve());
    if (c.var.travellerId === undefined) throw new Error('No traveller session.');
    return c.json(
      await createTopUp(deps.db, deps.clock, c.var.travellerId, body.data.amountMinor),
      201,
    );
  });
  routes.post('/top-ups/paypal', async (c) => {
    const body = createWalletTopUpSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(errorBody(c, 'bad_request', 'Choose an amount between $5 and $500.'), 400);
    await ensureTraveller(deps)(c, () => Promise.resolve());
    if (c.var.travellerId === undefined) throw new Error('No traveller session.');
    const added =
      deps.sandbox &&
      (await deps.autopay?.addFunds(c.var.travellerId, body.data.amountMinor, c.var.logger)) ===
        true;
    if (!added) {
      return c.json(
        errorBody(c, 'conflict', 'PayPal did not confirm this top-up. Nothing was added.'),
        409,
      );
    }
    return c.json(await readWallet(deps.db, c.var.travellerId, deps.sandbox));
  });
  return routes;
}
