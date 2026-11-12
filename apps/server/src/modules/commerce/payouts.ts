import { toInstant, type Money } from '@moviq/contracts';
import { z } from 'zod';

import {
  fromNewYorkWallClockText,
  toNewYorkWallClockText,
} from '../../infrastructure/clock/new-york.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { PayoutBatchRecord } from '../payments/payouts/payout-ledger.js';
import {
  payMerchant,
  refundsToDeduct,
  type OwedSales,
  type PayoutContext,
  type PayoutOutcome,
} from '../payments/payouts/payout-run.js';
import type { CommerceDependencies } from './context.js';
import type { Merchant } from './merchants.js';

const saleRow = z.object({ id: z.string(), captured_minor: z.number().int().nonnegative() });
const refundRow = z.object({
  order_id: z.string(),
  hold_id: z.string(),
  operation: z.string(),
  amount_minor: z.number().int().positive(),
});

/**
 * What a merchant may be paid for: each order collected and charged in PayPal up to `until`,
 * under the order's key, unless one of its refunds is still unconfirmed (it waits for PayPal);
 * and every refund PayPal confirmed from the merchant's orders, which the merchant bears.
 */
const owedSales: OwedSales = async (tx, merchantId, until) => {
  const sales = await tx.execute({
    sql: `SELECT o.id, h.captured_minor
          FROM commerce_orders o JOIN payment_holds h ON h.id = o.hold_id
          WHERE o.merchant_id = ? AND o.status = 'picked_up' AND h.status = 'captured'
            AND o.picked_up_at <= ?
            AND NOT EXISTS (SELECT 1 FROM payment_hold_refunds r
              WHERE r.hold_id = h.id AND r.status = 'unknown')
          ORDER BY o.picked_up_at`,
    args: [merchantId, toInstant(until)],
  });
  const refunds = await tx.execute({
    sql: `SELECT o.id AS order_id, r.hold_id, r.operation, r.amount_minor
          FROM payment_hold_refunds r JOIN commerce_orders o ON o.hold_id = r.hold_id
          WHERE o.merchant_id = ? AND r.status = 'completed'
          ORDER BY r.updated_at`,
    args: [merchantId],
  });
  return {
    sales: sales.rows.map((row) => {
      const sale = parseRow(saleRow, row, 'commerce_orders');
      return { key: `order:${sale.id}`, grossMinor: sale.captured_minor };
    }),
    refunds: refunds.rows.map((row) => {
      const refund = parseRow(refundRow, row, 'payment_hold_refunds');
      return {
        key: `refund:${refund.hold_id}:${refund.operation}`,
        of: `order:${refund.order_id}`,
        amountMinor: refund.amount_minor,
      };
    }),
  };
};

/** Monday 00:00 in New York of the week `now` falls in: the weekly payout covers before it. */
export function startOfWeek(now: Date): Date {
  const wall = toNewYorkWallClockText(now);
  const day = new Date(`${wall.slice(0, 10)}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  const monday = new Date(day.getTime() - sinceMonday * 86_400_000).toISOString().slice(0, 10);
  return fromNewYorkWallClockText(`${monday}T00:00:00`) ?? now;
}

export function payoutContext(
  deps: CommerceDependencies,
  logger: Logger,
): PayoutContext | undefined {
  if (deps.payouts === undefined) return undefined;
  return {
    db: deps.db,
    clock: deps.clock,
    logger,
    payouts: deps.payouts,
    write: (work) => deps.db.transaction(work),
    feePercent: deps.settings.payoutFeePercent,
  };
}

/** "Get paid now": everything collected until this moment. */
export function payNow(ctx: PayoutContext, merchant: Merchant): Promise<PayoutOutcome> {
  return payMerchant(ctx, {
    merchantId: merchant.summary.id,
    receiver: merchant.payoutReceiver,
    until: ctx.clock.now(),
    owed: owedSales,
  });
}

/** Refunds the merchant bears that are still to come out of its next payouts. */
export function merchantBalance(
  deps: Pick<CommerceDependencies, 'db' | 'clock'>,
  merchant: Merchant,
): Promise<Money> {
  return refundsToDeduct(
    { write: (work) => deps.db.transaction(work) },
    { merchantId: merchant.summary.id, until: deps.clock.now(), owed: owedSales },
  );
}

/** The weekly settlement of every merchant, for what was collected before this week. */
export async function payWeek(
  ctx: PayoutContext,
  merchants: readonly Merchant[],
): Promise<PayoutBatchRecord[]> {
  const until = startOfWeek(ctx.clock.now());
  const batches: PayoutBatchRecord[] = [];
  for (const merchant of merchants) {
    const outcome = await payMerchant(ctx, {
      merchantId: merchant.summary.id,
      receiver: merchant.payoutReceiver,
      until,
      owed: owedSales,
    });
    if (outcome.ok) batches.push(outcome.batch);
  }
  return batches;
}

export function payoutView(batch: PayoutBatchRecord) {
  return {
    id: batch.id,
    status: batch.status,
    gross: batch.gross,
    fee: batch.fee,
    net: batch.net,
    refunds: batch.refunds,
    until: batch.until,
    createdAt: batch.createdAt,
    detail: batch.detail,
  };
}
