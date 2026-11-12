import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { toInstant } from '@moviq/contracts';
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { AppBindings } from '../../infrastructure/http/context.js';

const COOKIE = 'moviq_session';
const TRAVELLER_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface TravellerBindings {
  Variables: AppBindings['Variables'] & {
    /** The traveller of this device, or undefined while they have not created anything. */
    readonly travellerId: string | undefined;
  };
}

export interface TravellerSessionDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
}

const rowSchema = z.object({ traveller_id: z.string() });
const hash = (sessionId: string) => createHash('sha256').update(sessionId).digest('hex');

/** Reads the traveller of this device, if any. Never creates one. */
export function readTraveller(
  deps: TravellerSessionDependencies,
): MiddlewareHandler<TravellerBindings> {
  return async (c, next) => {
    c.set('travellerId', await find(deps, getCookie(c, COOKIE)));
    await next();
  };
}

/**
 * Makes sure this device has a traveller, creating an anonymous one on its first action. Used
 * only on requests that create something, so plain visits leave nothing behind.
 */
export function ensureTraveller(
  deps: TravellerSessionDependencies,
): MiddlewareHandler<TravellerBindings> {
  return async (c, next) => {
    let travellerId = c.var.travellerId ?? (await find(deps, getCookie(c, COOKIE)));
    if (travellerId === undefined) {
      const created = await create(deps);
      travellerId = created.travellerId;
      setCookie(c, COOKIE, created.sessionId, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: deps.secureCookies,
        path: '/',
        maxAge: TRAVELLER_SESSION_TTL_MS / 1000,
      });
    }
    c.set('travellerId', travellerId);
    await next();
  };
}

async function find(
  deps: TravellerSessionDependencies,
  sessionId: string | undefined,
): Promise<string | undefined> {
  if (sessionId === undefined || sessionId.length > 128) return undefined;
  const result = await deps.db.query({
    sql: 'SELECT traveller_id FROM traveller_sessions WHERE id_hash = ? AND expires_at > ?',
    args: [hash(sessionId), toInstant(deps.clock.now())],
  });
  return result.rows.length === 0
    ? undefined
    : parseRow(rowSchema, result.rows[0], 'traveller_sessions').traveller_id;
}

async function create(
  deps: TravellerSessionDependencies,
): Promise<{ travellerId: string; sessionId: string }> {
  const now = deps.clock.now();
  const travellerId = randomUUID();
  const sessionId = randomBytes(32).toString('base64url');
  await deps.db.transaction(async (tx) => {
    await tx.execute({
      sql: 'INSERT INTO travellers (id, created_at, last_seen_at) VALUES (?, ?, ?)',
      args: [travellerId, toInstant(now), toInstant(now)],
    });
    await tx.execute({
      sql: 'INSERT INTO traveller_sessions (id_hash, traveller_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      args: [
        hash(sessionId),
        travellerId,
        toInstant(now),
        toInstant(new Date(now.getTime() + TRAVELLER_SESSION_TTL_MS)),
      ],
    });
  });
  return { travellerId, sessionId };
}
