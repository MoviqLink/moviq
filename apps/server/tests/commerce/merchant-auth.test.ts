import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { MERCHANT_TEST_TOKEN } from '../support/merchant-access.js';
import { loadConfig, configSecrets } from '../../src/config/config.js';
import { Secret } from '../../src/config/secret.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { merchantRoutes } from '../../src/modules/commerce/merchant-routes.js';
import { testApp } from '../support/app.js';
import { memoryLogger } from '../support/memory-logger.js';
import { commerceWorld, type CommerceWorld } from './support/commerce.js';

let world: CommerceWorld | undefined;
afterEach(async () => {
  await world?.temp.dispose();
});
const id = 'demo-tsuki-ramen-house';
const login = (app: Hono<AppBindings>, token?: string) =>
  app.request('/api/merchant/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ merchantId: id, token }),
  });
function withKey(current: CommerceWorld, token: Secret | undefined) {
  const app = new Hono<AppBindings>();
  app.use(requestContext(memoryLogger().logger));
  app.route('/api/merchant', merchantRoutes({ ...current.deps, merchantAccessToken: token }));
  return app;
}

describe('merchant credential boundary', () => {
  it('rejects missing and wrong keys without creating a session or leaking a cookie', async () => {
    world = await commerceWorld();
    for (const key of [undefined, '', 'wrong', 'x'.repeat(257)]) {
      const response = await login(world.app, key);
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.text()).not.toContain(MERCHANT_TEST_TOKEN);
    }
    const rows = await world.db.query('SELECT id_hash FROM commerce_merchant_sessions');
    expect(rows.rows).toHaveLength(0);
  });
  it('disables the panel when no key is configured', async () => {
    world = await commerceWorld();
    expect((await login(withKey(world, undefined), MERCHANT_TEST_TOKEN)).status).toBe(503);
  });
  it('requires a fresh login after key rotation and rejects legacy unprotected sessions', async () => {
    world = await commerceWorld();
    const response = await login(world.app, MERCHANT_TEST_TOKEN);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const cookie = setCookie.split(';')[0] ?? '';
    expect((await world.app.request('/api/merchant/tickets', { headers: { cookie } })).status).toBe(
      200,
    );
    const changed = withKey(world, new Secret('a-new-merchant-key-for-rotation-tests'));
    expect((await changed.request('/api/merchant/tickets', { headers: { cookie } })).status).toBe(
      401,
    );
    await world.db.execute('UPDATE commerce_merchant_sessions SET credential_hash = NULL');
    expect((await world.app.request('/api/merchant/tickets', { headers: { cookie } })).status).toBe(
      401,
    );
  });
  it('enforces the guards in the full application before commerce or payment work', async () => {
    world = await commerceWorld();
    const { app } = testApp({
      db: world.db,
      clock: world.clock,
      migrations: [],
      payments: world.deps.payments,
    });
    for (const path of ['/api/merchant/session', '/api/merchant/scan', '/api/payments/orders']) {
      const response = await app.request(path, {
        method: 'POST',
        headers: { origin: 'https://foreign.example', 'content-type': 'application/json' },
        body: JSON.stringify({ merchantId: id, token: MERCHANT_TEST_TOKEN }),
      });
      expect(response.status).toBe(403);
    }
    expect(world.paypal.calls).toHaveLength(0);
    for (let i = 0; i < 9; i += 1) expect((await login(app, 'incorrect')).status).toBe(401);
    const limited = await login(app, 'incorrect');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
  });

  it('validates configuration and includes the key among the logger redactions', () => {
    expect(loadConfig({ MERCHANT_ACCESS_TOKEN: 'short' }).ok).toBe(false);
    expect(loadConfig({ PUBLIC_ORIGIN: 'https://example.com/path' }).ok).toBe(false);
    const loaded = loadConfig({
      MERCHANT_ACCESS_TOKEN: MERCHANT_TEST_TOKEN,
      PUBLIC_ORIGIN: 'https://example.com',
    });
    if (!loaded.ok) throw new Error('Test configuration was refused');
    expect(
      configSecrets(loaded.config).some((secret) => secret.reveal() === MERCHANT_TEST_TOKEN),
    ).toBe(true);
    expect(JSON.stringify(loaded.config)).not.toContain(MERCHANT_TEST_TOKEN);
  });
});
