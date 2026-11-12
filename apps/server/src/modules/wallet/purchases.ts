import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { PurchaseCatalog } from '../payments/catalog.js';

const topUpSchema = z.object({
  traveller_id: z.string(),
  amount_minor: z.number(),
  currency: z.literal('USD'),
  payment_id: z.string().nullable(),
});
const paymentSchema = z.object({
  traveller_id: z.string(),
  status: z.string(),
  amount_minor: z.number(),
  currency: z.string(),
});

const DESCRIPTION = 'MovIQ trip wallet top-up';
const UNKNOWN = 'There is no top-up with that id.';

/** Top-ups as a purchase: priced from the row the server recorded, applied once captured. */
export function walletTopUps(deps: {
  readonly db: Database;
  readonly sandbox: boolean;
}): PurchaseCatalog {
  return {
    async quote(purpose, travellerId) {
      if (purpose.kind !== 'wallet-top-up') return { ok: false, reason: 'Not a top-up.' };
      if (!deps.sandbox)
        return { ok: false, reason: 'The trip wallet is available only in the PayPal sandbox.' };
      const result = await deps.db.query({
        sql: 'SELECT traveller_id, amount_minor, currency, payment_id FROM wallet_top_ups WHERE id = ?',
        args: [purpose.topUpId],
      });
      const row = result.rows[0];
      if (row === undefined) return { ok: false, reason: UNKNOWN };
      const topUp = parseRow(topUpSchema, row, 'wallet_top_ups');
      if (topUp.traveller_id !== travellerId || topUp.payment_id !== null)
        return { ok: false, reason: UNKNOWN };
      return {
        ok: true,
        amount: { amountMinor: topUp.amount_minor, currency: topUp.currency },
        description: DESCRIPTION,
      };
    },
    async fulfil(purpose, paymentId, tx) {
      if (purpose.kind !== 'wallet-top-up' || !deps.sandbox)
        throw new Error('The trip wallet is available only in the PayPal sandbox.');
      const result = await tx.execute({
        sql: 'SELECT traveller_id, amount_minor, currency, payment_id FROM wallet_top_ups WHERE id = ?',
        args: [purpose.topUpId],
      });
      const row = result.rows[0];
      if (row === undefined) throw new Error('Top-up does not exist.');
      const topUp = parseRow(topUpSchema, row, 'wallet_top_ups');
      if (topUp.payment_id === paymentId) return;
      if (topUp.payment_id !== null) throw new Error('Top-up already paid.');
      const paymentResult = await tx.execute({
        sql: 'SELECT traveller_id, status, amount_minor, currency FROM payment_operations WHERE id = ?',
        args: [paymentId],
      });
      const paymentRow = paymentResult.rows[0];
      if (paymentRow === undefined) throw new Error('Payment does not exist.');
      const payment = parseRow(paymentSchema, paymentRow, 'payment_operations');
      if (
        payment.traveller_id !== topUp.traveller_id ||
        payment.status !== 'captured' ||
        payment.amount_minor !== topUp.amount_minor ||
        payment.currency !== topUp.currency
      )
        throw new Error('Payment is not confirmed for this top-up.');
      const changed = await tx.execute({
        sql: 'UPDATE wallet_top_ups SET payment_id = ? WHERE id = ? AND payment_id IS NULL',
        args: [paymentId, purpose.topUpId],
      });
      if (changed.rowsAffected !== 1) throw new Error('Top-up already paid.');
    },
  };
}
