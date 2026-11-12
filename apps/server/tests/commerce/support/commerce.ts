import { Secret } from '../../../src/config/secret.js';
import type { NeedRequest, Taste } from '@moviq/contracts';
import { Hono } from 'hono';

import { MERCHANT_TEST_TOKEN } from '../../support/merchant-access.js';

import type { Database } from '../../../src/infrastructure/database/database.js';
import { requestContext, type AppBindings } from '../../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../../src/infrastructure/http/errors.js';
import type { MerchantAgent } from '../../../src/modules/commerce/agent.js';
import type { CommerceDependencies } from '../../../src/modules/commerce/context.js';
import { merchantRoutes } from '../../../src/modules/commerce/merchant-routes.js';
import { rulesAgent } from '../../../src/modules/commerce/rules-agent.js';
import { commerceSettings, type CommerceSettings } from '../../../src/modules/commerce/settings.js';
import { travellerCommerceRoutes } from '../../../src/modules/commerce/traveller-routes.js';
import type { PayPalPayouts } from '../../../src/modules/payments/paypal/payouts.js';
import { manualClock, type ManualClock } from '../../support/manual-clock.js';
import { memoryLogger } from '../../support/memory-logger.js';
import type { TempDatabase } from '../../support/temp-database.js';
import { CLIENT_ID } from '../../payments/support/api.js';
import { fakeHoldPayPal, type FakeHoldPayPal } from '../../payments/support/fake-paypal-holds.js';
import { paymentsDatabase } from '../../payments/support/payments.js';

/** 18:00 in New York on a Wednesday: every demo merchant but the bagel shop is open. */
export const EVENING = '2026-11-11T23:00:00.000Z';
/** East 125th Street & Lexington Avenue (M60), next to the demo Tsuki Ramen House. */
const RAMEN_STOP = '403671';
/** The traveller passes the stop half an hour from now. */
const PASS_IN_MS = 30 * 60_000;

export const TASTE: Taste = {
  allergies: ['peanuts'],
  avoid: ['scallions'],
  noAlcohol: true,
  diet: 'any',
  drink: 'cola',
  spice: 'mild',
};

export function needRequest(overrides: Partial<NeedRequest> = {}): NeedRequest {
  return {
    craving: 'ramen',
    alias: 'Mia',
    taste: TASTE,
    route: {
      stopId: RAMEN_STOP,
      at: new Date(new Date(EVENING).getTime() + PASS_IN_MS).toISOString(),
    },
    language: 'es',
    ...overrides,
  };
}

function settings(env: Record<string, string> = {}): CommerceSettings {
  const result = commerceSettings({ APP_ENV: 'test', ...env });
  if (!result.ok) throw new Error(result.problems.join('; '));
  return result.settings;
}

export interface CommerceWorld {
  readonly clock: ManualClock;
  readonly temp: TempDatabase;
  readonly db: Database;
  readonly paypal: FakeHoldPayPal;
  readonly deps: CommerceDependencies;
  readonly app: Hono<AppBindings>;
}

/** A migrated database with the demo merchants, PayPal in memory and both APIs mounted. */
export async function commerceWorld(
  options: {
    readonly agent?: MerchantAgent | ((db: Database, clock: ManualClock) => MerchantAgent);
    readonly settings?: CommerceSettings;
    readonly payouts?: PayPalPayouts;
  } = {},
): Promise<CommerceWorld> {
  const clock = manualClock(EVENING);
  const { temp, db } = await paymentsDatabase(clock);
  const paypal = fakeHoldPayPal();
  const deps: CommerceDependencies = {
    db,
    clock,
    settings: options.settings ?? settings(),
    agent:
      typeof options.agent === 'function'
        ? options.agent(db, clock)
        : (options.agent ?? rulesAgent),
    payments: {
      available: true,
      paypal,
      config: { available: true, clientId: CLIENT_ID, environment: 'sandbox', currency: 'USD' },
      webhookId: undefined,
    },
    payouts: options.payouts,
    secureCookies: false,
    merchantAccessToken: new Secret(MERCHANT_TEST_TOKEN),
  };
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/commerce', travellerCommerceRoutes(deps));
  app.route('/api/merchant', merchantRoutes(deps));
  app.onError(unexpectedError);
  return { clock, temp, db, paypal, deps, app };
}

/**
 * A browser talking to the API: it keeps the cookies it is given. Given a function, it asks it
 * for the server on every call, so a test can restart the server under the same browser.
 */
export function browser(server: Hono<AppBindings> | (() => Hono<AppBindings>)) {
  const cookies = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
    const app = typeof server === 'function' ? server() : server;
    const response = await app.request(path, {
      method,
      headers: {
        ...(cookie === '' ? {} : { cookie }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const set of response.headers.getSetCookie()) {
      const [pair = ''] = set.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (value === '') cookies.delete(name);
      else cookies.set(name, value);
    }
    const json: unknown = await response.json();
    return { status: response.status, body: json };
  };
  return {
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body),
    put: (path: string, body?: unknown) => call('PUT', path, body),
    delete: (path: string) => call('DELETE', path),
  };
}
