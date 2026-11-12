import { createHash, randomBytes } from 'node:crypto';
import { toInstant } from '@moviq/contracts';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { TicketRoutesDependencies } from './routes.js';

const COOKIE = 'moviq_ticket_demo_partner';
const SESSION_MS = 12 * 60 * 60_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function openDemoPartner(c: Context, deps: TicketRoutesDependencies): Promise<void> {
  const session = randomBytes(32).toString('base64url');
  const previous = getCookie(c, COOKIE);
  const now = deps.clock.now();
  await deps.db.transaction(async (tx) => {
    await tx.execute({
      sql: 'DELETE FROM ticket_demo_partner_sessions WHERE expires_at <= ? OR id_hash = ?',
      args: [
        toInstant(now),
        previous !== undefined && previous.length <= 128 ? hash(previous) : '',
      ],
    });
    await tx.execute({
      sql: 'INSERT INTO ticket_demo_partner_sessions (id_hash, expires_at) VALUES (?, ?)',
      args: [hash(session), toInstant(new Date(now.getTime() + SESSION_MS))],
    });
  });
  setCookie(c, COOKIE, session, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: deps.secureCookies,
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}
export async function closeDemoPartner(c: Context, deps: TicketRoutesDependencies): Promise<void> {
  const session = getCookie(c, COOKIE);
  if (session !== undefined && session.length <= 128)
    await deps.db.execute({
      sql: 'DELETE FROM ticket_demo_partner_sessions WHERE id_hash = ?',
      args: [hash(session)],
    });
  deleteCookie(c, COOKIE, { path: '/' });
}
export async function hasDemoPartner(c: Context, deps: TicketRoutesDependencies): Promise<boolean> {
  const session = getCookie(c, COOKIE);
  if (session === undefined || session.length > 128) return false;
  const result = await deps.db.query({
    sql: 'SELECT id_hash FROM ticket_demo_partner_sessions WHERE id_hash = ? AND expires_at > ?',
    args: [hash(session), toInstant(deps.clock.now())],
  });
  return result.rows.length > 0;
}
