import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Secret } from '../../config/secret.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/** A code is shown for this long; opening the order again shows a new one. */
const CODE_TTL_MS = 10 * 60_000;
/** A new code is issued once the last one has less than this left. */
const RENEW_BEFORE_MS = 2 * 60_000;
const VERSION = 'mq1';
const FORMAT = /^mq1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

export type CodeCheck =
  | { readonly ok: true; readonly orderId: string; readonly nonce: string }
  | {
      readonly ok: false;
      readonly reason: 'malformed' | 'forged' | 'expired' | 'used';
      readonly message: string;
    };

const MESSAGES = {
  malformed: 'This is not a MovIQ pickup code.',
  forged: 'This code was not issued by MovIQ. Nothing has been charged.',
  expired: 'This code has expired. Ask the customer to open their order again for a new one.',
  used: 'This code has already been used. Nothing more has been charged.',
} as const;

function sign(secret: Secret, payload: string): string {
  return createHmac('sha256', secret.reveal()).update(payload).digest('base64url');
}

/**
 * A pickup code for an order: `mq1.<order>.<nonce>.<expiry>.<HMAC-SHA256>`, signed with the
 * server's secret. The nonce is stored, so a code works once and only for its order; the
 * expiry is inside the signature, so it cannot be stretched.
 */
export async function issueCode(
  db: Database,
  secret: Secret,
  orderId: string,
  now: Date,
): Promise<{ readonly qr: string; readonly expiresAt: string }> {
  const latest = await db.query({
    sql: `SELECT nonce, expires_at FROM commerce_pickup_codes WHERE order_id = ? AND used_at IS NULL
          ORDER BY expires_at DESC LIMIT 1`,
    args: [orderId],
  });
  const row = latest.rows[0];
  const current = row === undefined ? undefined : parseRow(codeRow, row, 'commerce_pickup_codes');
  if (
    current !== undefined &&
    new Date(current.expires_at).getTime() - now.getTime() > RENEW_BEFORE_MS
  ) {
    return {
      qr: encode(secret, orderId, current.nonce, new Date(current.expires_at)),
      expiresAt: current.expires_at,
    };
  }
  const nonce = randomBytes(16).toString('base64url');
  const expiresAt = new Date(Math.floor((now.getTime() + CODE_TTL_MS) / 1000) * 1000);
  await db.execute({
    sql: 'INSERT INTO commerce_pickup_codes (nonce, order_id, issued_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [nonce, orderId, toInstant(now), toInstant(expiresAt)],
  });
  return { qr: encode(secret, orderId, nonce, expiresAt), expiresAt: toInstant(expiresAt) };
}

function encode(secret: Secret, orderId: string, nonce: string, expiresAt: Date): string {
  const payload = `${VERSION}.${orderId}.${nonce}.${String(Math.floor(expiresAt.getTime() / 1000))}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Checks a scanned code: its shape, its signature, its expiry, and that it was never used. */
export async function checkCode(
  db: Database,
  secret: Secret,
  code: string,
  now: Date,
): Promise<CodeCheck> {
  const match = FORMAT.exec(code.trim());
  if (match === null) return fail('malformed');
  const [, orderId = '', nonce = '', expiry = '', signature = ''] = match;
  const expected = Buffer.from(sign(secret, `${VERSION}.${orderId}.${nonce}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return fail('forged');
  if (Number(expiry) * 1000 <= now.getTime()) return fail('expired');
  const stored = await db.query({
    sql: 'SELECT used_at FROM commerce_pickup_codes WHERE nonce = ? AND order_id = ?',
    args: [nonce, orderId],
  });
  const row = stored.rows[0];
  if (row === undefined) return fail('forged');
  if (parseRow(usedRow, row, 'commerce_pickup_codes').used_at !== null) return fail('used');
  return { ok: true, orderId, nonce };
}

/** Marks every code of an order used, in the transaction that records its pickup. */
export async function retireCodes(tx: Transaction, orderId: string, now: Date): Promise<void> {
  await tx.execute({
    sql: 'UPDATE commerce_pickup_codes SET used_at = ? WHERE order_id = ? AND used_at IS NULL',
    args: [toInstant(now), orderId],
  });
}

const codeRow = z.object({ nonce: z.string(), expires_at: z.string() });
const usedRow = z.object({ used_at: z.string().nullable() });
const fail = (reason: Exclude<CodeCheck, { ok: true }>['reason']): CodeCheck => ({
  ok: false,
  reason,
  message: MESSAGES[reason],
});
