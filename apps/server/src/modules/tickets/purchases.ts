import { ticketProductSchema } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { PurchaseCatalog } from '../payments/catalog.js';
import { productOf } from './catalog.js';

const intentSchema = z.object({
  traveller_id: z.string(),
  product_id: z.string(),
  product_json: z.string(),
  payment_id: z.string().nullable(),
});
const paymentSchema = z.object({
  traveller_id: z.string(),
  status: z.string(),
  purpose: z.string(),
  amount_minor: z.number(),
  currency: z.string(),
});

/** Sandbox is checked at quote and fulfilment, including reconciliations and webhook processing. */
export function ticketPurchases(deps: {
  readonly db: Database;
  readonly sandbox: boolean;
}): PurchaseCatalog {
  return {
    async quote(purpose, travellerId) {
      if (purpose.kind !== 'ticket-product')
        return { ok: false, reason: 'Not a ticket demonstration.' };
      if (!deps.sandbox)
        return {
          ok: false,
          reason: 'Ticket demonstrations are available only in the PayPal sandbox.',
        };
      const result = await deps.db.query({
        sql: 'SELECT traveller_id, product_id, product_json, payment_id FROM ticket_intents WHERE id = ?',
        args: [purpose.intentId],
      });
      const row = result.rows[0];
      if (row === undefined) return { ok: false, reason: 'No ticket demonstration with that id.' };
      const intent = parseRow(intentSchema, row, 'ticket_intents');
      if (intent.traveller_id !== travellerId || intent.payment_id !== null)
        return { ok: false, reason: 'No ticket demonstration with that id.' };
      const product = productOf(intent.product_id);
      const saved = ticketProductSchema.parse(JSON.parse(intent.product_json));
      if (product === undefined || JSON.stringify(product) !== JSON.stringify(saved))
        return { ok: false, reason: 'This demonstration price has changed. Start again.' };
      return { ok: true, amount: product.price, description: product.name };
    },
    async fulfil(purpose, paymentId, tx) {
      if (purpose.kind !== 'ticket-product' || !deps.sandbox)
        throw new Error('Ticket demonstrations are available only in the PayPal sandbox.');
      const result = await tx.execute({
        sql: 'SELECT traveller_id, product_id, product_json, payment_id FROM ticket_intents WHERE id = ?',
        args: [purpose.intentId],
      });
      const row = result.rows[0];
      if (row === undefined) throw new Error('Ticket demonstration does not exist.');
      const intent = parseRow(intentSchema, row, 'ticket_intents');
      if (intent.payment_id === paymentId) return;
      if (intent.payment_id !== null) throw new Error('Ticket demonstration already fulfilled.');
      const paymentResult = await tx.execute({
        sql: 'SELECT traveller_id, status, purpose, amount_minor, currency FROM payment_operations WHERE id = ?',
        args: [paymentId],
      });
      const paymentRow = paymentResult.rows[0];
      if (paymentRow === undefined) throw new Error('Payment does not exist.');
      const payment = parseRow(paymentSchema, paymentRow, 'payment_operations');
      const product = ticketProductSchema.parse(JSON.parse(intent.product_json));
      const paidPurpose: unknown = JSON.parse(payment.purpose);
      if (
        payment.traveller_id !== intent.traveller_id ||
        payment.status !== 'captured' ||
        payment.amount_minor !== product.price.amountMinor ||
        payment.currency !== product.price.currency ||
        JSON.stringify(paidPurpose) !== JSON.stringify(purpose)
      )
        throw new Error('Payment is not confirmed for this traveller.');
      const changed = await tx.execute({
        sql: 'UPDATE ticket_intents SET payment_id = ? WHERE id = ? AND payment_id IS NULL',
        args: [paymentId, purpose.intentId],
      });
      if (changed.rowsAffected !== 1) throw new Error('Ticket demonstration already fulfilled.');
    },
  };
}
