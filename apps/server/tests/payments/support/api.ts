import { Hono } from 'hono';

import type { Clock } from '../../../src/infrastructure/clock/clock.js';
import type { Database } from '../../../src/infrastructure/database/database.js';
import { requestContext, type AppBindings } from '../../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../../src/infrastructure/http/errors.js';
import type { PurchaseCatalog } from '../../../src/modules/payments/catalog.js';
import { paymentsRoutes } from '../../../src/modules/payments/routes.js';
import type { PaymentsSetup } from '../../../src/modules/payments/setup.js';
import { memoryLogger } from '../../support/memory-logger.js';
import type { FakePayPal } from './fake-paypal.js';

export const CLIENT_ID = 'public-client-id-for-tests';
const WEBHOOK_ID = '1JE4291016473214C';

/** PayPal set up with the fake; `webhooks: false` stands for a server without PAYPAL_WEBHOOK_ID. */
export function availableSetup(paypal: FakePayPal, options = { webhooks: true }): PaymentsSetup {
  return {
    available: true,
    paypal,
    config: { available: true, clientId: CLIENT_ID, environment: 'sandbox', currency: 'USD' },
    webhookId: options.webhooks ? WEBHOOK_ID : undefined,
  };
}

/** The payments routes mounted as the application mounts them, under `/api/payments`. */
export function paymentsApp(input: {
  readonly db: Database;
  readonly clock: Clock;
  readonly catalog: PurchaseCatalog;
  readonly setup: PaymentsSetup;
}): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/payments', paymentsRoutes({ ...input, secureCookies: false }));
  app.onError(unexpectedError);
  return app;
}

/** A device talking to the API: it keeps the session cookie it is given. */
export function device(app: Hono<AppBindings>) {
  let cookie = '';
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const response = await app.request(`/api/payments${path}`, {
      method,
      headers: {
        ...(cookie === '' ? {} : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = response.headers.get('set-cookie');
    if (set !== null) cookie = set.split(';')[0] ?? '';
    return { status: response.status, body: await response.json() };
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body),
  };
}
