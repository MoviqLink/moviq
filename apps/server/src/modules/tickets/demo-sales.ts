import { ticketProductSchema, type TicketDemoPartner } from '@moviq/contracts';
import type { Row } from '@libsql/client';
import { z } from 'zod';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { NOTICE } from './catalog.js';
const rowSchema = z.object({
  id: z.string(),
  product_json: z.string(),
  payment_id: z.string(),
  paypal_order_id: z.string().nullable(),
  paypal_capture_id: z.string().nullable(),
  status: z.enum(['captured', 'refunded']),
  created_at: z.string(),
});
const totalsSchema = z.object({
  sales: z.number().int(),
  refunded: z.number().int(),
  amount_minor: z.number().int(),
  refunded_minor: z.number().int(),
});
type Totals = z.infer<typeof totalsSchema>;
/** Ticket intents belong exclusively to the single fictional transport provider. */
export async function demoSales(db: Database): Promise<TicketDemoPartner> {
  return db.transaction(async (tx) => {
    const result = await tx.execute({
      sql: `SELECT i.id, i.product_json, i.payment_id, p.paypal_order_id, p.paypal_capture_id,
      p.amount_minor, p.currency, p.status, h.at AS created_at,
      COALESCE((SELECT SUM(r.amount_minor) FROM payment_refunds r
        WHERE r.payment_id = p.id AND r.paypal_status = 'COMPLETED'), 0) AS refunded_minor
      FROM ticket_intents i JOIN payment_operations p ON p.id = i.payment_id
      JOIN payment_history h ON h.id = (SELECT id FROM payment_history
        WHERE payment_id = p.id AND to_status = 'captured' ORDER BY id LIMIT 1)
      WHERE p.traveller_id = i.traveller_id AND p.status IN ('captured', 'refunded')
      ORDER BY h.at DESC, i.id DESC LIMIT 101`,
      args: [],
    });
    const totalsResult = await tx.execute({
      sql: `SELECT COUNT(*) AS sales,
    COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded,
    COALESCE(SUM(p.amount_minor), 0) AS amount_minor,
    COALESCE(SUM(CASE WHEN p.status = 'refunded' THEN p.amount_minor ELSE MIN(p.amount_minor,
      COALESCE((SELECT SUM(r.amount_minor) FROM payment_refunds r WHERE r.payment_id = p.id
        AND r.paypal_status = 'COMPLETED'), 0)) END), 0) AS refunded_minor
    FROM ticket_intents i JOIN payment_operations p ON p.id = i.payment_id
    WHERE p.traveller_id = i.traveller_id AND p.status IN ('captured', 'refunded')
      AND EXISTS (SELECT 1 FROM payment_history h WHERE h.payment_id = p.id AND h.to_status = 'captured')`,
      args: [],
    });
    const totals = parseRow(totalsSchema, totalsResult.rows[0], 'ticket_demo_totals');
    return buildSales(result.rows, totals);
  });
}

function buildSales(rows: readonly Row[], totals: Totals): TicketDemoPartner {
  const sale = rowSchema.extend({
    amount_minor: z.number().int(),
    currency: z.string(),
    refunded_minor: z.number().int(),
  });
  return {
    demo: true,
    notice: NOTICE,
    hasMore: rows.length > 100,
    totals: {
      sales: totals.sales,
      refunded: totals.refunded,
      amountMinor: totals.amount_minor,
      refundedMinor: totals.refunded_minor,
      netMinor: totals.amount_minor - totals.refunded_minor,
      currency: 'USD',
    },
    items: rows.slice(0, 100).map((row) => {
      const value = parseRow(sale, row, 'ticket_demo_sales');
      // A fully refunded status is authoritative even for older rows lacking refund detail.
      const refunded =
        value.status === 'refunded'
          ? value.amount_minor
          : Math.min(value.amount_minor, value.refunded_minor);
      return {
        id: value.id,
        paymentId: value.payment_id,
        paypalOrderId: value.paypal_order_id,
        paypalCaptureId: value.paypal_capture_id,
        product: ticketProductSchema.parse(JSON.parse(value.product_json)),
        amountMinor: value.amount_minor,
        currency: value.currency,
        refundedMinor: refunded,
        netMinor: value.amount_minor - refunded,
        status: value.status,
        createdAt: value.created_at,
      };
    }),
  };
}
