import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import { toInstant, type OrderStatus } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/** A line of the kitchen ticket: exactly what to make, with what is left out and added. */
export interface TicketLine {
  readonly name: string;
  readonly quantity: number;
  readonly remove: readonly string[];
  readonly add: readonly string[];
  /** What the traveller pays for this line after the reward, for a refund if it is missing. */
  readonly paidMinor: number;
}

export interface OrderRecord {
  readonly id: string;
  readonly offerId: string;
  readonly holdId: string;
  readonly travellerId: string;
  readonly merchantId: string;
  readonly code: string;
  readonly alias: string;
  readonly status: OrderStatus;
  readonly pickupAt: string;
  readonly kitchenStartsAt: string;
  readonly ticket: readonly TicketLine[];
  readonly createdAt: string;
  readonly pickedUpAt: string | null;
  readonly version: number;
}

/** The changes the kitchen and the counter may make, as in `commerce_order_transitions`. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  reserved: ['preparing', 'ready', 'picked_up', 'cancelled'],
  preparing: ['ready', 'picked_up'],
  ready: ['picked_up'],
  picked_up: [],
  cancelled: [],
};

const ticketSchema = z.array(
  z.object({
    name: z.string(),
    quantity: z.number().int().positive(),
    remove: z.array(z.string()),
    add: z.array(z.string()),
    paidMinor: z.number().int().nonnegative(),
  }),
);

const orderRow = z
  .object({
    id: z.string(),
    offer_id: z.string(),
    hold_id: z.string(),
    traveller_id: z.string(),
    merchant_id: z.string(),
    code: z.string(),
    alias: z.string(),
    status: z.enum(['reserved', 'preparing', 'ready', 'picked_up', 'cancelled']),
    pickup_at: z.string(),
    kitchen_starts_at: z.string(),
    ticket: z.string().transform((text, context) => {
      const parsed = ticketSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      context.addIssue({ code: 'custom', message: parsed.error.message });
      return z.NEVER;
    }),
    created_at: z.string(),
    picked_up_at: z.string().nullable(),
    version: z.number().int(),
  })
  .transform((row): OrderRecord => ({
    id: row.id,
    offerId: row.offer_id,
    holdId: row.hold_id,
    travellerId: row.traveller_id,
    merchantId: row.merchant_id,
    code: row.code,
    alias: row.alias,
    status: row.status,
    pickupAt: row.pickup_at,
    kitchenStartsAt: row.kitchen_starts_at,
    ticket: row.ticket,
    createdAt: row.created_at,
    pickedUpAt: row.picked_up_at,
    version: row.version,
  }));

const toOrder = (row: unknown) => parseRow(orderRow, row, 'commerce_orders');
const countSchema = z.object({ n: z.number().int() });
type Reader = Database | Transaction;
const read = (db: Reader, sql: string, args: (string | number)[]) =>
  'query' in db ? db.query({ sql, args }) : db.execute({ sql, args });

const QUARTER_HOUR_MS = 15 * 60_000;
const FIRST_CODE = 1001;

export const orderStore = {
  async insert(
    tx: Transaction,
    order: Omit<OrderRecord, 'id' | 'code' | 'status' | 'createdAt' | 'pickedUpAt' | 'version'>,
    letter: string,
    now: Date,
  ): Promise<OrderRecord> {
    const count = await tx.execute({
      sql: 'SELECT COUNT(*) AS n FROM commerce_orders WHERE merchant_id = ?',
      args: [order.merchantId],
    });
    const next = FIRST_CODE + parseRow(countSchema, count.rows[0], 'commerce_orders').n;
    const result = await tx.execute({
      sql: `INSERT INTO commerce_orders (id, offer_id, hold_id, traveller_id, merchant_id, code, alias,
              status, pickup_at, kitchen_starts_at, ticket, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, 1) RETURNING *`,
      args: [
        randomUUID(),
        order.offerId,
        order.holdId,
        order.travellerId,
        order.merchantId,
        `${letter}-${String(next % 10_000).padStart(4, '0')}`,
        order.alias,
        order.pickupAt,
        order.kitchenStartsAt,
        JSON.stringify(order.ticket),
        toInstant(now),
        toInstant(now),
      ],
    });
    return toOrder(result.rows[0]);
  },

  /** Moves an order if it is still `from` (version check); undefined when it had moved. */
  async move(
    tx: Transaction,
    order: OrderRecord,
    to: OrderStatus,
    now: Date,
  ): Promise<OrderRecord | undefined> {
    const result = await tx.execute({
      sql: `UPDATE commerce_orders SET status = ?, updated_at = ?, version = version + 1,
              picked_up_at = CASE WHEN ? = 'picked_up' THEN ? ELSE picked_up_at END
            WHERE id = ? AND version = ? RETURNING *`,
      args: [to, toInstant(now), to, toInstant(now), order.id, order.version],
    });
    const row = result.rows[0];
    return row === undefined ? undefined : toOrder(row);
  },

  async find(db: Reader, id: string): Promise<OrderRecord | undefined> {
    const row = (await read(db, 'SELECT * FROM commerce_orders WHERE id = ?', [id])).rows[0];
    return row === undefined ? undefined : toOrder(row);
  },

  async ofHold(db: Reader, holdId: string): Promise<OrderRecord | undefined> {
    const row = (await read(db, 'SELECT * FROM commerce_orders WHERE hold_id = ?', [holdId]))
      .rows[0];
    return row === undefined ? undefined : toOrder(row);
  },

  async ofTraveller(db: Database, travellerId: string): Promise<readonly OrderRecord[]> {
    const result = await read(
      db,
      'SELECT * FROM commerce_orders WHERE traveller_id = ? ORDER BY pickup_at DESC LIMIT 50',
      [travellerId],
    );
    return result.rows.map(toOrder);
  },

  async ofMerchant(db: Database, merchantId: string, since: Date): Promise<readonly OrderRecord[]> {
    const result = await read(
      db,
      'SELECT * FROM commerce_orders WHERE merchant_id = ? AND pickup_at >= ? ORDER BY pickup_at',
      [merchantId, toInstant(since)],
    );
    return result.rows.map(toOrder);
  },

  /** Live orders whose pickup falls in the same quarter hour as `pickupAt`. */
  async inSlot(db: Reader, merchantId: string, pickupAt: Date): Promise<number> {
    const start = Math.floor(pickupAt.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
    const result = await read(
      db,
      `SELECT COUNT(*) AS n FROM commerce_orders WHERE merchant_id = ? AND pickup_at >= ? AND pickup_at < ?
         AND status IN ('reserved', 'preparing', 'ready')`,
      [merchantId, toInstant(new Date(start)), toInstant(new Date(start + QUARTER_HOUR_MS))],
    );
    return parseRow(countSchema, result.rows[0], 'commerce_orders').n;
  },
};
