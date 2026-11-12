import { Hono } from 'hono';

import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import { createEventCatalog, type EventCatalogDependencies } from './catalog.js';
import { parseEventQuery } from './query.js';

/**
 * `/api/events`: `GET /?from=&to=&bbox=&category=`, the events of New York that have not ended,
 * with their listings and the state of every provider. Nothing is sold here: each event carries
 * only the official pages its sources give.
 */
export function eventRoutes(deps: EventCatalogDependencies): Hono<AppBindings> {
  const catalog = createEventCatalog(deps);
  const routes = new Hono<AppBindings>();
  routes.get('/', async (c) => {
    const query = parseEventQuery(
      {
        from: c.req.query('from'),
        to: c.req.query('to'),
        bbox: c.req.query('bbox'),
        category: c.req.query('category'),
      },
      deps.clock.now(),
    );
    if (!query.ok) return c.json(errorBody(c, 'bad_request', query.message), 400);
    return c.json(await catalog.list(query.value));
  });
  return routes;
}
