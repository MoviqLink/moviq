import { createHash, timingSafeEqual } from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import type { Secret } from '../../config/secret.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import type { CommerceDependencies } from './context.js';
import { openMerchantSession } from './merchant-sessions.js';
import { merchantStore } from './merchants.js';

const loginSchema = z.strictObject({
  merchantId: z.string().min(1).max(100),
  token: z.string().min(1).max(256),
});

/** The shared demo credential grants access only to demo merchants, never to real merchant accounts. */
export function merchantLogin(deps: CommerceDependencies): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  routes.post('/session', async (c) => {
    const token = deps.merchantAccessToken;
    if (token === undefined)
      return c.json(errorBody(c, 'unavailable', 'Merchant access is not configured.'), 503);
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success || !matches(parsed.data.token, token)) {
      return c.json(errorBody(c, 'unauthorized', 'The merchant access key is not valid.'), 401);
    }
    const merchant = await merchantStore.find(deps.db, parsed.data.merchantId);
    if (merchant === undefined)
      return c.json(errorBody(c, 'not_found', 'There is no demo merchant with that id.'), 404);
    await openMerchantSession(c, deps, merchant.summary.id);
    c.header('Cache-Control', 'no-store');
    return c.json({ signedIn: true, merchant: merchant.summary });
  });
  return routes;
}

/** Fixed-size digests keep comparison independent of the candidate's length. */
function matches(candidate: string, token: Secret): boolean {
  return timingSafeEqual(
    createHash('sha256').update(candidate).digest(),
    createHash('sha256').update(token.reveal()).digest(),
  );
}
