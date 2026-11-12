import { planResponseSchema, type PlanResponse } from '@moviq/contracts';
import { Hono } from 'hono';
import { expect } from 'vitest';

import type { Clock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { requestContext } from '../../src/infrastructure/http/context.js';
import { createPlanner } from '../../src/modules/journeys/planner.js';
import type { RoutingProvider } from '../../src/modules/journeys/ports.js';
import { journeyRoutes } from '../../src/modules/journeys/routes.js';
import { memoryLogger } from './memory-logger.js';
import { planRequest } from './journeys.js';

/** The journeys API under `/api`, with the given routing engine and no public fares. */
export function journeyApp(input: {
  readonly db: Database;
  readonly clock: Clock;
  readonly routing: RoutingProvider;
}): Hono {
  const { db, clock, routing } = input;
  const planner = createPlanner({ db, clock, routing, fares: { fareFor: () => null } });
  const app = new Hono();
  app.use(requestContext(memoryLogger().logger));
  app.route(
    '/api',
    journeyRoutes({
      db,
      clock,
      planner,
      sessions: { db, clock, secureCookies: false },
      eventPollMs: 20,
    }),
  );
  return app;
}

/** A JSON POST, with the traveller's cookie when there is one. */
export const postJson = (body: unknown, cookie = '') => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie === '' ? {} : { cookie }) },
  body: JSON.stringify(body),
});

/** Plans the standard trip; the first plan of a new traveller also brings their cookie. */
export async function planAs(
  app: Hono,
  cookie = '',
): Promise<{ plan: PlanResponse; cookie: string }> {
  const response = await app.request('/api/plan', postJson(planRequest(), cookie));
  expect(response.status).toBe(200);
  const setCookie = response.headers.get('set-cookie');
  return {
    plan: planResponseSchema.parse(await response.json()),
    cookie: setCookie === null ? cookie : (setCookie.split(';')[0] ?? ''),
  };
}
