import { randomUUID } from 'node:crypto';

import {
  ticketProductSchema,
  toInstant,
  type TicketIntent,
  type TicketWallet,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { NOTICE, productOf } from './catalog.js';

const rowSchema = z.object({
  id: z.string(),
  product_json: z.string(),
  payment_id: z.string(),
  paypal_order_id: z.string().nullable(),
  paypal_capture_id: z.string().nullable(),
  status: z.enum(['captured', 'refunded']),
  created_at: z.string(),
});

export async function createIntent(
  db: Database,
  clock: Clock,
  travellerId: string,
  productId: string,
): Promise<TicketIntent | undefined> {
  const product = productOf(productId);
  if (product === undefined) return undefined;
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO ticket_intents (id, traveller_id, product_id, product_json, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [id, travellerId, product.id, JSON.stringify(product), toInstant(clock.now())],
  });
  return { id, product, purpose: { kind: 'ticket-product', intentId: id } };
}

/** A refunded payment stays visible as refunded; it never remains an active receipt. */
export async function wallet(db: Database, travellerId: string | undefined): Promise<TicketWallet> {
  if (travellerId === undefined) return { demo: true, notice: NOTICE, hasMore: false, items: [] };
  const result = await db.query({
    sql: `SELECT i.id, i.product_json, i.payment_id, p.paypal_order_id, p.paypal_capture_id,
      h.at AS created_at, p.status
    FROM ticket_intents i JOIN payment_operations p ON p.id = i.payment_id
    JOIN payment_history h ON h.id = (
      SELECT id FROM payment_history WHERE payment_id = p.id AND to_status = 'captured'
      ORDER BY id LIMIT 1
    )
    WHERE i.traveller_id = ? AND p.traveller_id = ? AND p.status IN ('captured', 'refunded')
    ORDER BY h.at DESC, i.id DESC LIMIT 101`,
    args: [travellerId, travellerId],
  });
  const items = result.rows.slice(0, 100).map((row) => {
    const value = parseRow(rowSchema, row, 'ticket_intents');
    return {
      id: value.id,
      product: ticketProductSchema.parse(JSON.parse(value.product_json)),
      paymentId: value.payment_id,
      paypalOrderId: value.paypal_order_id,
      paypalCaptureId: value.paypal_capture_id,
      status: value.status,
      createdAt: value.created_at,
    };
  });
  return {
    demo: true,
    notice: NOTICE,
    hasMore: result.rows.length > 100,
    items,
  };
}
