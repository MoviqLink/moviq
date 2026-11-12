import { createHash, randomBytes } from 'node:crypto';

import { toInstant } from '@moviq/contracts';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import type { Secret } from '../../config/secret.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { AppBindings } from '../../infrastructure/http/context.js';
import { errorBody } from '../../infrastructure/http/errors.js';

const COOKIE = 'moviq_merchant';
const SESSION_TTL_MS = 12 * 60 * 60_000;

export interface MerchantBindings {
  Variables: AppBindings['Variables'] & {
    /** The demo merchant this session signed in as. */
    readonly merchantId: string;
  };
}

interface SessionDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  readonly merchantAccessToken?: Secret | undefined;
}

const hash = (sessionId: string) => createHash('sha256').update(sessionId).digest('hex');
const rowSchema = z.object({ merchant_id: z.string() });

/** Signs in as a demo merchant: an `HttpOnly` cookie whose hash only is stored. */
export async function openMerchantSession(
  c: Context,
  deps: SessionDependencies,
  merchantId: string,
): Promise<void> {
  if (deps.merchantAccessToken === undefined) throw new Error('Merchant access is not configured.');
  const now = deps.clock.now();
  const sessionId = randomBytes(32).toString('base64url');
  await deps.db.execute({
    sql: `INSERT INTO commerce_merchant_sessions
          (id_hash, merchant_id, created_at, expires_at, credential_hash)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      hash(sessionId),
      merchantId,
      toInstant(now),
      toInstant(new Date(now.getTime() + SESSION_TTL_MS)),
      hash(deps.merchantAccessToken.reveal()),
    ],
  });
  setCookie(c, COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: deps.secureCookies,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function closeMerchantSession(c: Context, deps: SessionDependencies): Promise<void> {
  const sessionId = getCookie(c, COOKIE);
  if (sessionId !== undefined && sessionId.length <= 128) {
    await deps.db.execute({
      sql: 'DELETE FROM commerce_merchant_sessions WHERE id_hash = ?',
      args: [hash(sessionId)],
    });
  }
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function sessionMerchant(
  c: Context,
  deps: SessionDependencies,
): Promise<string | undefined> {
  if (deps.merchantAccessToken === undefined) return undefined;
  const sessionId = getCookie(c, COOKIE);
  if (sessionId === undefined || sessionId.length > 128) return undefined;
  const result = await deps.db.query({
    sql: `SELECT merchant_id FROM commerce_merchant_sessions
          WHERE id_hash = ? AND expires_at > ? AND credential_hash = ?`,
    args: [hash(sessionId), toInstant(deps.clock.now()), hash(deps.merchantAccessToken.reveal())],
  });
  const row = result.rows[0];
  return row === undefined
    ? undefined
    : parseRow(rowSchema, row, 'commerce_merchant_sessions').merchant_id;
}

/** Only a signed-in merchant passes: 401 without a session. */
export function requireMerchant(deps: SessionDependencies): MiddlewareHandler<MerchantBindings> {
  return async (c, next) => {
    const merchantId = await sessionMerchant(c, deps);
    if (merchantId === undefined) {
      return c.json(errorBody(c, 'unauthorized', 'Sign in to your merchant panel first.'), 401);
    }
    c.set('merchantId', merchantId);
    await next();
    return undefined;
  };
}
