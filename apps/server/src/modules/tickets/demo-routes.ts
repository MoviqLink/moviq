import { Hono } from 'hono';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  ensureTraveller,
  readTraveller,
  type TravellerBindings,
} from '../identity/traveller-sessions.js';
import { demoSales } from './demo-sales.js';
import { closeDemoPartner, hasDemoPartner, openDemoPartner } from './demo-sessions.js';
import type { TicketRoutesDependencies } from './routes.js';

export function demoRoutes(deps: TicketRoutesDependencies): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  const enabled = () => deps.demoEnabled === true && deps.sandbox;
  routes.get('/status', (c) => c.json({ enabled: enabled() }));
  const buyerAvailable = () => enabled() && deps.buyerEnabled === true && deps.buyer !== undefined;
  routes.get('/buyer-status', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ available: buyerAvailable() });
  });
  routes.get('/buyer', (c) => {
    c.header('Cache-Control', 'no-store');
    if (!buyerAvailable() || deps.buyer === undefined)
      return c.json(errorBody(c, 'not_found', 'Demo buyer unavailable.'), 404);
    return c.json({ email: deps.buyer.email.reveal(), password: deps.buyer.password.reveal() });
  });
  const traveller = new Hono<TravellerBindings>();
  traveller.use(readTraveller(deps));
  traveller.post('/traveller', async (c) => {
    if (!enabled()) return c.json(errorBody(c, 'not_found', 'Demo unavailable.'), 404);
    await ensureTraveller(deps)(c, () => Promise.resolve());
    return c.json({ demo: true as const });
  });
  routes.route('/', traveller);
  routes.post('/partner', async (c) => {
    if (!enabled()) return c.json(errorBody(c, 'not_found', 'Demo unavailable.'), 404);
    await openDemoPartner(c, deps);
    return c.json({ demo: true as const });
  });
  routes.post('/logout', async (c) => {
    await closeDemoPartner(c, deps);
    return c.json({ demo: true as const });
  });
  routes.get('/partner', async (c) => {
    if (!enabled()) return c.json(errorBody(c, 'not_found', 'Demo unavailable.'), 404);
    if (!(await hasDemoPartner(c, deps)))
      return c.json(errorBody(c, 'unauthorized', 'Sign in to the demo partner panel.'), 401);
    return c.json(await demoSales(deps.db));
  });
  return routes;
}
