import type { MiddlewareHandler } from 'hono';

import type { AppBindings } from './context.js';
import { errorBody } from './errors.js';

/** Exact scheme and host, or a non-browser caller without Origin. Forwarded headers are ignored. */
export function sameOrigin(request: Request, publicOrigin?: string): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  try {
    return new URL(origin).origin === (publicOrigin ?? new URL(request.url).origin);
  } catch {
    return false;
  }
}

/** Browser mutations use the public origin. PayPal callbacks instead require their signature. */
export function requireSameOrigin(publicOrigin?: string): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) ||
      c.req.path === '/api/payments/webhooks'
    )
      return next();
    if (!sameOrigin(c.req.raw, publicOrigin))
      return c.json(errorBody(c, 'forbidden', 'This action must come from this application.'), 403);
    return next();
  };
}
