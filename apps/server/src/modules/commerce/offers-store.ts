import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import {
  offerLineSchema,
  tasteSchema,
  toInstant,
  type OfferLine,
  type Taste,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

export interface NeedRecord {
  readonly id: string;
  readonly travellerId: string;
  readonly craving: string;
  readonly alias: string;
  readonly taste: Taste;
  readonly language: 'en' | 'es';
  readonly journeyId: string | null;
  readonly createdAt: string;
}

export interface OfferRecord {
  readonly id: string;
  readonly threadId: string;
  readonly travellerId: string;
  readonly merchantId: string;
  readonly lines: readonly OfferLine[];
  readonly listMinor: number;
  readonly priceMinor: number;
  readonly pickupAt: string;
  readonly detourMinutes: number;
  readonly note: string;
  readonly composer: 'model' | 'rules';
  readonly recommended: boolean;
  readonly status: 'open' | 'declined' | 'reserved' | 'expired';
  readonly expiresAt: string;
}

const json = <T>(schema: z.ZodType<T>) =>
  z.string().transform((text, context): T => {
    const parsed = schema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  });

const needRow = z
  .object({
    id: z.string(),
    traveller_id: z.string(),
    craving: z.string(),
    alias: z.string(),
    taste: json(tasteSchema),
    language: z.enum(['en', 'es']),
    journey_id: z.string().nullable(),
    created_at: z.string(),
  })
  .transform((row): NeedRecord => ({
    id: row.id,
    travellerId: row.traveller_id,
    craving: row.craving,
    alias: row.alias,
    taste: row.taste,
    language: row.language,
    journeyId: row.journey_id,
    createdAt: row.created_at,
  }));

const offerRow = z
  .object({
    id: z.string(),
    thread_id: z.string(),
    traveller_id: z.string(),
    merchant_id: z.string(),
    lines: json(z.array(offerLineSchema)),
    list_minor: z.number().int().positive(),
    price_minor: z.number().int().positive(),
    pickup_at: z.string(),
    detour_minutes: z.number().int(),
    note: z.string(),
    composer: z.enum(['model', 'rules']),
    recommended: z.number().int(),
    status: z.enum(['open', 'declined', 'reserved', 'expired']),
    expires_at: z.string(),
  })
  .transform((row): OfferRecord => ({
    id: row.id,
    threadId: row.thread_id,
    travellerId: row.traveller_id,
    merchantId: row.merchant_id,
    lines: row.lines,
    listMinor: row.list_minor,
    priceMinor: row.price_minor,
    pickupAt: row.pickup_at,
    detourMinutes: row.detour_minutes,
    note: row.note,
    composer: row.composer,
    recommended: row.recommended === 1,
    status: row.status,
    expiresAt: row.expires_at,
  }));

/**
 * Why an offer can no longer be booked at `now`, the server's time, or undefined while it can:
 * it must still be open, unexpired and with its pickup ahead.
 */
export function offerClosed(
  offer: Pick<OfferRecord, 'status' | 'expiresAt' | 'pickupAt'>,
  now: Date,
): string | undefined {
  if (offer.status !== 'open') return 'This offer is no longer available.';
  if (Date.parse(offer.expiresAt) <= now.getTime()) return 'This offer has expired.';
  if (Date.parse(offer.pickupAt) <= now.getTime())
    return 'The pickup time of this offer has passed.';
  return undefined;
}

const toOffer = (row: unknown) => parseRow(offerRow, row, 'commerce_offers');
type Reader = Database | Transaction;
const read = (db: Reader, sql: string, args: (string | number)[]) =>
  'query' in db ? db.query({ sql, args }) : db.execute({ sql, args });

export const needStore = {
  async insert(
    tx: Transaction,
    need: Omit<NeedRecord, 'id' | 'createdAt'>,
    now: Date,
  ): Promise<NeedRecord> {
    const result = await tx.execute({
      sql: `INSERT INTO commerce_needs (id, traveller_id, craving, alias, taste, language, journey_id,
              created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        randomUUID(),
        need.travellerId,
        need.craving,
        need.alias,
        JSON.stringify(need.taste),
        need.language,
        need.journeyId,
        toInstant(now),
      ],
    });
    return parseRow(needRow, result.rows[0], 'commerce_needs');
  },

  async find(db: Reader, id: string): Promise<NeedRecord | undefined> {
    const row = (await read(db, 'SELECT * FROM commerce_needs WHERE id = ?', [id])).rows[0];
    return row === undefined ? undefined : parseRow(needRow, row, 'commerce_needs');
  },
};

export const offerStore = {
  async insert(
    tx: Transaction,
    offer: Omit<OfferRecord, 'id' | 'recommended' | 'status'>,
    now: Date,
  ): Promise<OfferRecord> {
    const result = await tx.execute({
      sql: `INSERT INTO commerce_offers (id, thread_id, traveller_id, merchant_id, lines, list_minor,
              price_minor, currency, pickup_at, detour_minutes, note, composer, recommended, status,
              expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 0, 'open', ?, ?) RETURNING *`,
      args: [
        randomUUID(),
        offer.threadId,
        offer.travellerId,
        offer.merchantId,
        JSON.stringify(offer.lines),
        offer.listMinor,
        offer.priceMinor,
        offer.pickupAt,
        offer.detourMinutes,
        offer.note,
        offer.composer,
        offer.expiresAt,
        toInstant(now),
      ],
    });
    return toOffer(result.rows[0]);
  },

  async find(db: Reader, id: string): Promise<OfferRecord | undefined> {
    const row = (await read(db, 'SELECT * FROM commerce_offers WHERE id = ?', [id])).rows[0];
    return row === undefined ? undefined : toOffer(row);
  },

  async ofThread(db: Reader, threadId: string): Promise<OfferRecord | undefined> {
    const row = (await read(db, 'SELECT * FROM commerce_offers WHERE thread_id = ?', [threadId]))
      .rows[0];
    return row === undefined ? undefined : toOffer(row);
  },

  /** Moves an offer on only from `from`; false when it had already moved. */
  async move(
    tx: Transaction,
    id: string,
    from: OfferRecord['status'],
    to: OfferRecord['status'],
  ): Promise<boolean> {
    const result = await tx.execute({
      sql: 'UPDATE commerce_offers SET status = ? WHERE id = ? AND status = ?',
      args: [to, id, from],
    });
    return result.rowsAffected === 1;
  },

  async recommend(tx: Transaction, id: string): Promise<void> {
    await tx.execute({
      sql: 'UPDATE commerce_offers SET recommended = 1 WHERE id = ?',
      args: [id],
    });
  },
};
