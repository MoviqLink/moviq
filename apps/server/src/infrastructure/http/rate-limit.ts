import { createHash } from 'node:crypto';

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';

import type { Clock } from '../clock/clock.js';
import type { AppBindings } from './context.js';
import { errorBody } from './errors.js';
import { windowLimit } from './window-limit.js';

export interface RequestProtection {
  readonly publicOrigin?: string | undefined;
  /** The transport peer only. Forwarded headers must never be trusted without a proxy policy. */
  readonly clientAddress?: ((context: Context<AppBindings>) => string | undefined) | undefined;
}

/** Per-process budgets: bounded memory, no database writes, no timer, and no raw IP retention. */
export function rateLimit(
  clock: Clock,
  options: RequestProtection = {},
): MiddlewareHandler<AppBindings> {
  const global = windowLimit(clock, 6000, 60_000, 1);
  const peers = windowLimit(clock, 1200);
  const writes = windowLimit(clock, 120);
  const logins = windowLimit(clock, 10);
  const aiPeers = windowLimit(clock, 60);
  const aiSessions = windowLimit(clock, 12);
  return async (c, next) => {
    const peer = digest(options.clientAddress?.(c) ?? 'unknown-peer');
    const delays = [global('all'), peers(peer)];
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.path !== '/api/payments/webhooks'
    ) {
      delays.push(writes(peer));
      if (c.req.path.endsWith('/session') && c.req.method === 'POST') delays.push(logins(peer));
    }
    if (usesPlanningBudget(c.req.path, c.req.method)) {
      const cookie = getCookie(
        c,
        c.req.path.startsWith('/api/merchant/') ? 'moviq_merchant' : 'moviq_session',
      );
      const session = cookie !== undefined && cookie.length <= 128 ? digest(cookie) : peer;
      delays.push(aiPeers(peer), aiSessions(session));
    }

    const retry = Math.max(...delays);
    if (retry > 0) {
      c.header('Retry-After', String(retry));
      return c.json(
        errorBody(c, 'rate_limited', 'Too many requests. Please wait before trying again.'),
        429,
      );
    }
    return next();
  };
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Explicit model/planner work and virtual origin lookups share one traveller allowance. */
function usesPlanningBudget(path: string, method: string): boolean {
  if (path === '/api/virtual/places') return method === 'GET';
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  return (
    path.startsWith('/api/assistant/') ||
    (path.startsWith('/api/agents/') && path.endsWith('/turns')) ||
    path === '/api/plan' ||
    path === '/api/commerce/needs' ||
    (path.startsWith('/api/commerce/needs/') && path.endsWith('/answers')) ||
    (path.startsWith('/api/virtual/rides/') && /\/(needs|estimate|journey)$/.test(path)) ||
    path.endsWith('/agent/talk')
  );
}
