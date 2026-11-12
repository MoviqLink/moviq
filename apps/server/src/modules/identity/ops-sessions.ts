import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { opsRoleSchema, toInstant, type OpsRole, type OpsSession } from '@moviq/contracts';
import { z } from 'zod';

import type { Secret } from '../../config/secret.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

export const OPS_SESSION_TTL_MS = 12 * 60 * 60_000;

export interface OpsTokens {
  readonly admin: Secret | undefined;
  readonly viewer: Secret | undefined;
}

export interface OpsActor {
  readonly role: OpsRole;
  /** A stable, non-secret label for the audit log, derived from the session. */
  readonly actor: string;
  readonly expiresAt: string;
}

const sessionRowSchema = z.object({ role: opsRoleSchema, expires_at: z.string() });

/** The role a token grants, compared in constant time; undefined for anything else. */
export function roleForToken(token: string, tokens: OpsTokens): OpsRole | undefined {
  if (matches(token, tokens.admin)) return 'admin';
  if (matches(token, tokens.viewer)) return 'viewer';
  return undefined;
}

function matches(candidate: string, secret: Secret | undefined): boolean {
  if (secret === undefined) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(secret.reveal()).digest();
  return timingSafeEqual(a, b);
}

const hash = (sessionId: string) => createHash('sha256').update(sessionId).digest('hex');

export const opsSessions = {
  /** Creates a session and returns its id, which only the cookie carries. */
  async open(db: Database, role: OpsRole, now: Date): Promise<{ id: string; session: OpsSession }> {
    const id = randomBytes(32).toString('base64url');
    const expiresAt = toInstant(new Date(now.getTime() + OPS_SESSION_TTL_MS));
    await db.execute({
      sql: 'INSERT INTO ops_sessions (id_hash, role, created_at, expires_at) VALUES (?, ?, ?, ?)',
      args: [hash(id), role, toInstant(now), expiresAt],
    });
    return { id, session: { role, expiresAt } };
  },

  async find(db: Database, id: string, now: Date): Promise<OpsActor | undefined> {
    const idHash = hash(id);
    const result = await db.query({
      sql: 'SELECT role, expires_at FROM ops_sessions WHERE id_hash = ? AND expires_at > ?',
      args: [idHash, toInstant(now)],
    });
    if (result.rows.length === 0) return undefined;
    const row = parseRow(sessionRowSchema, result.rows[0], 'ops_sessions');
    return {
      role: row.role,
      actor: `ops:${row.role}:${idHash.slice(0, 8)}`,
      expiresAt: row.expires_at,
    };
  },

  async close(db: Database, id: string, now: Date): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM ops_sessions WHERE id_hash = ? OR expires_at <= ?',
      args: [hash(id), toInstant(now)],
    });
  },
};
