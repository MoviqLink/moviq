import { opsLoginRequestSchema, type OpsSession } from '@moviq/contracts';
import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { sameOrigin } from '../../infrastructure/http/origin.js';
import { errorBody } from '../../infrastructure/http/errors.js';
import {
  OPS_SESSION_TTL_MS,
  opsSessions,
  roleForToken,
  type OpsActor,
  type OpsTokens,
} from '../identity/ops-sessions.js';

export interface OpsBindings {
  Variables: AppBindings['Variables'] & { readonly opsActor: OpsActor };
}

export interface OpsAuthDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly tokens: OpsTokens;
  /** Cookies are marked Secure outside local development. */
  readonly secureCookies: boolean;
  readonly publicOrigin?: string | undefined;
}

const COOKIE = 'moviq_ops';
const LOGIN_ATTEMPTS_PER_MINUTE = 10;

/** `/api/ops/session`: exchange a token for a cookie, read the session, close it. */
export function sessionRoutes(deps: OpsAuthDependencies): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();
  const attempts = loginLimiter(deps.clock);
  routes.post('/', async (c) => {
    if (!attempts.allow())
      return c.json(errorBody(c, 'bad_request', 'Too many attempts. Wait a minute.'), 429);
    const body = opsLoginRequestSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success)
      return c.json(
        errorBody(c, 'bad_request', 'Send the operations token as {"token": "…"}.'),
        400,
      );
    const role = roleForToken(body.data.token, deps.tokens);
    if (role === undefined)
      return c.json(
        errorBody(c, 'unauthorized', 'That token does not open the control room.'),
        401,
      );
    const { id } = await opsSessions.open(deps.db, role, deps.clock.now());
    setCookie(c, COOKIE, id, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: deps.secureCookies,
      path: '/api/ops',
      maxAge: OPS_SESSION_TTL_MS / 1000,
    });
    c.var.logger.info('ops session opened', { role });
    return c.body(null, 204);
  });
  routes.get('/', async (c) => {
    const actor = await currentActor(c.req.raw, deps, getCookie(c, COOKIE));
    if (actor === undefined)
      return c.json(errorBody(c, 'unauthorized', 'Sign in to the control room.'), 401);
    return c.json<OpsSession>({ role: actor.role, expiresAt: actor.expiresAt });
  });
  routes.delete('/', async (c) => {
    const id = getCookie(c, COOKIE);
    if (id !== undefined) await opsSessions.close(deps.db, id, deps.clock.now());
    deleteCookie(c, COOKIE, { path: '/api/ops' });
    return c.body(null, 204);
  });
  return routes;
}

/** Requires a valid session; unsafe methods also require the request to come from our origin. */
export function requireOpsSession(deps: OpsAuthDependencies): MiddlewareHandler<OpsBindings> {
  return async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method) && !sameOrigin(c.req.raw, deps.publicOrigin)) {
      return c.json(
        errorBody(c, 'forbidden', 'This action must come from the control room itself.'),
        403,
      );
    }
    const actor = await currentActor(c.req.raw, deps, getCookie(c, COOKIE));
    if (actor === undefined)
      return c.json(errorBody(c, 'unauthorized', 'Sign in to the control room.'), 401);
    c.set('opsActor', actor);
    await next();
    return undefined;
  };
}

/** Lets only administrators through; viewers get a plain refusal. */
export const requireAdmin: MiddlewareHandler<OpsBindings> = async (c, next) => {
  if (c.var.opsActor.role !== 'admin') {
    return c.json(errorBody(c, 'forbidden', 'Read-only access cannot change anything.'), 403);
  }
  await next();
  return undefined;
};

async function currentActor(
  _request: Request,
  deps: OpsAuthDependencies,
  id: string | undefined,
): Promise<OpsActor | undefined> {
  if (id === undefined || id.length > 128) return undefined;
  return opsSessions.find(deps.db, id, deps.clock.now());
}

function loginLimiter(clock: Clock): { allow(): boolean } {
  let windowStart = 0;
  let count = 0;
  return {
    allow() {
      const now = clock.now().getTime();
      if (now - windowStart >= 60_000) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count <= LOGIN_ATTEMPTS_PER_MINUTE;
    },
  };
}
