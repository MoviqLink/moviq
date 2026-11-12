import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { Secret } from '../../src/config/secret.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { ticketRoutes } from '../../src/modules/tickets/routes.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';

function application(
  sandbox: boolean,
  demoEnabled: boolean,
  buyerEnabled: boolean,
  buyerPresent = true,
) {
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route(
    '/api/tickets',
    ticketRoutes({
      db: {} as Database,
      clock: manualClock(),
      secureCookies: false,
      sandbox,
      demoEnabled,
      buyerEnabled,
      buyer: buyerPresent
        ? {
            email: new Secret('buyer@personal.example.com'),
            password: new Secret('test-only-password'),
          }
        : undefined,
    }),
  );
  return app;
}

describe('sandbox test buyer access', () => {
  it('only exposes the configured test buyer when all gates are enabled, without caching', async () => {
    const enabled = application(true, true, true);
    const response = await enabled.request('/api/tickets/demo/buyer');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      email: 'buyer@personal.example.com',
      password: 'test-only-password',
    });
    for (const server of [
      application(false, true, true),
      application(true, false, true),
      application(true, true, false),
      application(true, true, true, false),
    ]) {
      const status = await server.request('/api/tickets/demo/buyer-status');
      expect(await status.json()).toEqual({ available: false });
      expect((await server.request('/api/tickets/demo/buyer')).status).toBe(404);
    }
  });
});
