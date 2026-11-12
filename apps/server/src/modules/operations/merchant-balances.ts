import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import { merchantStore } from '../commerce/merchants.js';
import { merchantBalance, startOfWeek } from '../commerce/payouts.js';
import type { OpenObligation } from '../payments/open-obligations.js';

const WEEK_MS = 7 * 24 * 60 * 60_000;

const sinceSchema = z.object({ since: z.string().nullable() });

/**
 * Since when a merchant owes refunds: the oldest refund PayPal confirmed from a sale already paid
 * out that no live batch has deducted yet. The keys are the ones `commerce/payouts.ts` gives a
 * sale (`order:<id>`) and a refund (`refund:<hold>:<operation>`).
 */
async function owedSince(db: Database, merchantId: string): Promise<string | null> {
  const result = await db.query({
    sql: `SELECT MIN(r.updated_at) AS since
          FROM payment_hold_refunds r JOIN commerce_orders o ON o.hold_id = r.hold_id
          WHERE o.merchant_id = ? AND r.status = 'completed'
            AND EXISTS (SELECT 1 FROM payout_items i
              WHERE i.active = 1 AND i.item_key = 'order:' || o.id)
            AND NOT EXISTS (SELECT 1 FROM payout_items i
              WHERE i.active = 1 AND i.item_key = 'refund:' || r.hold_id || ':' || r.operation)`,
    args: [merchantId],
  });
  return parseRow(sinceSchema, result.rows[0], 'payment_hold_refunds').since;
}

/**
 * What each merchant still owes MovIQ for refunds of sales already paid out, as the merchant's own
 * screen shows it. It comes out of the next weekly payout, so that is when it is looked at again.
 */
export async function merchantBalances(
  deps: { readonly db: Database; readonly clock: Clock },
  now: Date,
): Promise<readonly OpenObligation[]> {
  const nextPayout = startOfWeek(new Date(now.getTime() + WEEK_MS)).toISOString();
  const owed: OpenObligation[] = [];
  for (const merchant of await merchantStore.all(deps.db)) {
    const balance = await merchantBalance(deps, merchant);
    if (balance.amountMinor <= 0) continue;
    const id = merchant.summary.id;
    owed.push({
      id: `merchant-balance:${id}`,
      kind: 'merchant-balance',
      reference: `merchant ${id}`,
      status: 'owed',
      amountMinor: balance.amountMinor,
      since: (await owedSince(deps.db, id)) ?? now.toISOString(),
      attempts: null,
      detail: null,
      nextCheckAt: nextPayout,
    });
  }
  return owed;
}
