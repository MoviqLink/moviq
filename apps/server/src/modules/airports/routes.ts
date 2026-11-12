import { boardQuerySchema } from '@moviq/contracts';
import { Hono } from 'hono';

import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import type { AirportBoardService } from './board.js';

/**
 * `/api/airports`: `GET /:code/board?direction=departures|arrivals`, the board of JFK, LGA or
 * EWR with ADS-B now and the FAA's status. A board is refreshed only here, when it is due and
 * the units allow it; the request's own cancellation does not stop a refresh others wait for.
 */
export function airportRoutes(deps: { readonly service: AirportBoardService }): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  routes.get('/:code/board', async (c) => {
    const query = boardQuerySchema.safeParse({
      code: c.req.param('code'),
      direction: c.req.query('direction'),
    });
    if (!query.success) {
      return c.json(
        errorBody(c, 'bad_request', 'Ask for JFK, LGA or EWR, and for departures or arrivals.'),
        400,
      );
    }
    return c.json(await deps.service.board(query.data.code, query.data.direction));
  });
  return routes;
}
