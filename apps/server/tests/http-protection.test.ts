import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requestContext, type AppBindings } from '../src/infrastructure/http/context.js';
import { requireSameOrigin } from '../src/infrastructure/http/origin.js';
import { rateLimit } from '../src/infrastructure/http/rate-limit.js';
import { windowLimit } from '../src/infrastructure/http/window-limit.js';
import { manualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';

function protectedApp() {
  const clock = manualClock();
  const app = new Hono<AppBindings>();
  let calls = 0;
  app.use(requestContext(memoryLogger().logger));
  app.use('/api/*', rateLimit(clock, { clientAddress: () => '192.0.2.1' }));
  app.use('/api/*', requireSameOrigin('https://demo.example'));
  app.all('/api/*', (c) => {
    calls += 1;
    return c.json({ reached: true });
  });
  return { app, clock, calls: () => calls };
}

it('bounds stored keys without evicting an active allowance, and expires them', () => {
  const clock = manualClock();
  const allow = windowLimit(clock, 2, 60_000, 2);
  expect(allow('a')).toBe(0);
  expect(allow('a')).toBe(0);
  expect(allow('a')).toBe(60);
  expect(allow('b')).toBe(0);
  expect(allow('c')).toBe(60);
  expect(allow('a')).toBe(60);
  clock.advance(59_001);
  expect(allow('a')).toBe(1);
  clock.advance(999);
  expect(allow('c')).toBe(0);
  expect(allow('a')).toBe(0);
});

describe('browser request origin', () => {
  it.each(['https://other.example', 'http://demo.example', 'null', 'not a URL'])(
    'refuses %s before a payment or merchant mutation runs',
    async (origin) => {
      const { app, calls } = protectedApp();
      const response = await app.request('/api/merchant/scan', {
        method: 'POST',
        headers: { origin },
      });
      expect(response.status).toBe(403);
      expect(calls()).toBe(0);
    },
  );
  it('uses the configured public origin behind TLS termination', async () => {
    const { app } = protectedApp();
    expect(
      (
        await app.request('http://internal:8080/api/payments/orders', {
          method: 'POST',
          headers: { origin: 'https://demo.example' },
        })
      ).status,
    ).toBe(200);
  });
  it('rejects cross-site browser requests without Origin but admits non-browser clients', async () => {
    const { app } = protectedApp();
    expect(
      (
        await app.request('/api/commerce/needs', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    expect((await app.request('/api/commerce/needs', { method: 'POST' })).status).toBe(200);
  });
});

it('limits logins before work, ignores spoofed forwarding headers, and gives a retry time', async () => {
  const { app, clock, calls } = protectedApp();
  for (let i = 0; i < 10; i += 1)
    expect((await app.request('/api/merchant/session', { method: 'POST' })).status).toBe(200);
  const denied = await app.request('/api/merchant/session', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.2', 'cf-connecting-ip': '198.51.100.2' },
  });
  expect(denied.status).toBe(429);
  expect(denied.headers.get('retry-after')).toBe('60');
  expect(calls()).toBe(10);
  clock.advance(60_000);
  expect((await app.request('/api/merchant/session', { method: 'POST' })).status).toBe(200);
});

it('limits AI per session and keeps an IP budget even if cookies change', async () => {
  const { app } = protectedApp();
  for (let i = 0; i < 12; i += 1)
    expect(
      (
        await app.request('/api/assistant/turns', {
          method: 'POST',
          headers: { cookie: 'moviq_session=one' },
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await app.request('/api/assistant/turns', {
        method: 'POST',
        headers: { cookie: 'moviq_session=one' },
      })
    ).status,
  ).toBe(429);
  for (let i = 0; i < 47; i += 1)
    expect(
      (
        await app.request('/api/assistant/turns', {
          method: 'POST',
          headers: { cookie: `moviq_session=other-${String(i)}` },
        })
      ).status,
    ).toBe(200);
  expect(
    (
      await app.request('/api/assistant/turns', {
        method: 'POST',
        headers: { cookie: 'moviq_session=new' },
      })
    ).status,
  ).toBe(429);
  expect((await app.request('/api/live/vehicles')).status).toBe(200);
  expect((await app.request('/api/payments/webhooks', { method: 'POST' })).status).toBe(200);
});

it('shares the AI allowance across Sara and additional agent conversations', async () => {
  const { app } = protectedApp();
  const headers = { cookie: 'moviq_session=same-traveller' };
  for (let i = 0; i < 12; i += 1) {
    const path = i % 2 === 0 ? '/api/assistant/turns' : '/api/agents/agent-two/turns';
    expect((await app.request(path, { method: 'POST', headers })).status).toBe(200);
  }
  expect(
    (await app.request('/api/agents/agent-three/turns', { method: 'POST', headers })).status,
  ).toBe(429);
  expect((await app.request('/api/agents/agent-three')).status).toBe(200);
});

it('shares planning allowance with virtual negotiation, routing and origin lookups', async () => {
  const { app } = protectedApp();
  const headers = { cookie: 'moviq_session=virtual-traveller' };
  const paths = [
    '/api/virtual/places?q=station',
    '/api/virtual/rides/r/needs',
    '/api/virtual/rides/r/estimate',
    '/api/virtual/rides/r/journey',
    '/api/commerce/needs/n/answers',
  ];
  for (let index = 0; index < 12; index += 1) {
    const path = paths[index % paths.length] ?? paths[0];
    if (path === undefined) throw new Error('Missing test path');
    const method = path.includes('/places') ? 'GET' : 'POST';
    expect((await app.request(path, { method, headers })).status).toBe(200);
  }
  expect(
    (await app.request('/api/virtual/rides/r/estimate', { method: 'POST', headers })).status,
  ).toBe(429);
  expect((await app.request('/api/virtual/rides/r', { headers })).status).toBe(200);
});
