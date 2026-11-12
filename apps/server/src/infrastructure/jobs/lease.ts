import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../clock/clock.js';
import type { Database } from '../database/database.js';
import { parseRow } from '../database/rows.js';

/** A time-limited right to run the work named `name`. Only one holder at a time. */
export interface Lease {
  readonly name: string;
  readonly holder: string;
  readonly fencingToken: number;
  readonly expiresAt: string;
}

export interface LeaseStore {
  /** Takes the lease if it is free or expired. Returns undefined while someone else holds it. */
  acquire(name: string, holder: string, ttlMs: number): Promise<Lease | undefined>;
  /** Extends a lease still held. Returns undefined if it expired or changed hands. */
  renew(lease: Lease, ttlMs: number): Promise<Lease | undefined>;
  /** Lets the lease go at once, so another process can take it without waiting. */
  release(lease: Lease): Promise<void>;
}

const acquiredSchema = z.object({
  fencing_token: z.number().int().positive(),
  expires_at: z.string(),
});
const renewedSchema = z.object({ expires_at: z.string() });

const ACQUIRE = `INSERT INTO worker_leases
  (name, holder, fencing_token, acquired_at, renewed_at, expires_at)
VALUES (:name, :holder, 1, :now, :now, :expires)
ON CONFLICT (name) DO UPDATE SET
  holder = excluded.holder,
  fencing_token = worker_leases.fencing_token + 1,
  acquired_at = excluded.acquired_at,
  renewed_at = excluded.renewed_at,
  expires_at = excluded.expires_at
WHERE worker_leases.expires_at <= excluded.acquired_at
RETURNING fencing_token, expires_at`;

const RENEW = `UPDATE worker_leases SET renewed_at = :now, expires_at = :expires
WHERE name = :name AND holder = :holder AND fencing_token = :token AND expires_at > :now
RETURNING expires_at`;

const RELEASE = `UPDATE worker_leases SET expires_at = :now
WHERE name = :name AND holder = :holder AND fencing_token = :token AND expires_at > :now`;

/**
 * Each operation reads the clock inside its write transaction, once the write lock is held, so
 * a call that waited for the lock judges expiry at the moment it writes.
 */
export function createLeaseStore(db: Database, clock: Clock): LeaseStore {
  const times = (ttlMs: number) => {
    const now = clock.now();
    return { now: toInstant(now), expires: toInstant(new Date(now.getTime() + ttlMs)) };
  };
  const ids = (lease: Lease) => ({
    name: lease.name,
    holder: lease.holder,
    token: lease.fencingToken,
  });

  return {
    acquire: (name, holder, ttlMs) =>
      db.transaction(async (tx) => {
        const result = await tx.execute({ sql: ACQUIRE, args: { name, holder, ...times(ttlMs) } });
        if (result.rows.length === 0) return undefined;
        const row = parseRow(acquiredSchema, result.rows[0], 'worker_leases acquire');
        return { name, holder, fencingToken: row.fencing_token, expiresAt: row.expires_at };
      }),
    renew: (lease, ttlMs) =>
      db.transaction(async (tx) => {
        const result = await tx.execute({ sql: RENEW, args: { ...ids(lease), ...times(ttlMs) } });
        if (result.rows.length === 0) return undefined;
        const row = parseRow(renewedSchema, result.rows[0], 'worker_leases renew');
        return { ...lease, expiresAt: row.expires_at };
      }),
    release: (lease) =>
      db.transaction(async (tx) => {
        await tx.execute({ sql: RELEASE, args: { ...ids(lease), now: toInstant(clock.now()) } });
      }),
  };
}
