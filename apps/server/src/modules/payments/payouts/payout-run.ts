import type { Transaction } from '@libsql/client';
import type { Money } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { Database } from '../../../infrastructure/database/database.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import { describeFailure } from '../context.js';
import { toPayPalError } from '../paypal/errors.js';
import type { PayoutBatch, PayoutBatchStatus, PayPalPayouts } from '../paypal/payouts.js';
import {
  payoutLedger,
  type OwedItem,
  type OwedRefund,
  type PayoutBatchRecord,
  type PayoutStatus,
} from './payout-ledger.js';

/**
 * What the selling module says about a merchant up to an instant: the sales it may be paid for
 * and every refund confirmed from its sales. Payouts decides which are still owed.
 */
export type OwedSales = (
  tx: Transaction,
  merchantId: string,
  until: Date,
) => Promise<{ readonly sales: readonly OwedItem[]; readonly refunds: readonly OwedRefund[] }>;

/**
 * Who bears a refund: the merchant. One made before its sale is paid is deducted in the batch
 * that pays the sale; one made after is deducted from the next batches, and until then it is
 * a balance the merchant owes, never paid out negative. Each refund is deducted once.
 */
async function owedNow(
  tx: Transaction,
  input: { readonly merchantId: string; readonly until: Date; readonly owed: OwedSales },
) {
  const owed = await input.owed(tx, input.merchantId, input.until);
  const paid = await payoutLedger.paidKeys(tx, [
    ...owed.sales.map((sale) => sale.key),
    ...owed.refunds.flatMap((refund) => [refund.key, refund.of]),
  ]);
  const sales = owed.sales.filter((sale) => !paid.has(sale.key) && sale.grossMinor > 0);
  const paying = new Set(sales.map((sale) => sale.key));
  const pending = owed.refunds.filter((refund) => !paid.has(refund.key));
  return {
    sales,
    refunds: pending.filter((refund) => paying.has(refund.of) || paid.has(refund.of)),
    /** Refunds of sales already paid out, still to be deducted. */
    balance: pending
      .filter((refund) => paid.has(refund.of))
      .reduce((sum, refund) => sum + refund.amountMinor, 0),
  };
}

/** What the merchant owes MovIQ for refunds made after their sale was paid out. */
export async function refundsToDeduct(
  ctx: Pick<PayoutContext, 'write'>,
  input: { readonly merchantId: string; readonly until: Date; readonly owed: OwedSales },
): Promise<Money> {
  const owed = await ctx.write((tx) => owedNow(tx, input));
  return { amountMinor: owed.balance, currency: 'USD' };
}

export interface PayoutContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly payouts: PayPalPayouts;
  readonly write: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
  /** MovIQ's commission on each payout, in whole percent. */
  readonly feePercent: number;
}

export type PayoutOutcome =
  | { readonly ok: true; readonly batch: PayoutBatchRecord }
  | {
      readonly ok: false;
      readonly reason: 'nothing-owed' | 'refused';
      readonly message: string;
      readonly batch?: PayoutBatchRecord;
    };

const LOOK_AGAIN_MS = 10 * 60_000;

const STATUS: Readonly<Record<PayoutBatchStatus, PayoutStatus>> = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  DENIED: 'denied',
  CANCELED: 'canceled',
};

/**
 * Pays a merchant what is owed until `until` in one PayPal batch. The batch and its sales are
 * written first, in one transaction, so two calls at once never pay the same sale; the batch id
 * is PayPal's `sender_batch_id`, which PayPal refuses to pay twice.
 */
export async function payMerchant(
  ctx: PayoutContext,
  input: {
    readonly merchantId: string;
    readonly receiver: string;
    readonly until: Date;
    readonly owed: OwedSales;
  },
): Promise<PayoutOutcome> {
  const batch = await ctx.write(async (tx) => {
    const { sales, refunds } = await owedNow(tx, input);
    const deducted = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
    const gross = sales.reduce((sum, sale) => sum + sale.grossMinor, 0) - deducted;
    const feeMinor = Math.round((gross * ctx.feePercent) / 100);
    // Never a payout of nothing or less: what is owed back waits for the next sales.
    if (sales.length === 0 || gross - feeMinor <= 0) return undefined;
    return payoutLedger.insert(tx, { ...input, items: sales, refunds, feeMinor }, ctx.clock.now());
  });
  if (batch === undefined) {
    return { ok: false, reason: 'nothing-owed', message: 'There is nothing to pay out yet.' };
  }
  return sendBatch(ctx, batch);
}

async function sendBatch(ctx: PayoutContext, batch: PayoutBatchRecord): Promise<PayoutOutcome> {
  try {
    const answer = await ctx.payouts.createBatch({
      senderBatchId: batch.id,
      emailSubject: 'Your MovIQ payout',
      receiver: batch.receiver,
      amount: batch.net,
      note: 'MovIQ sales, less the MovIQ commission.',
    });
    return { ok: true, batch: await record(ctx, batch, answer) };
  } catch (error) {
    const failure = toPayPalError('payouts.create', error);
    ctx.logger.warn('payout batch not accepted', {
      batchId: batch.id,
      detail: describeFailure(failure),
    });
    if (failure.outcome === 'unknown') {
      return {
        ok: true,
        batch: await write(ctx, batch, 'unknown', null, describeFailure(failure)),
      };
    }
    const failed = await write(ctx, batch, 'failed', null, describeFailure(failure));
    return {
      ok: false,
      reason: 'refused',
      message: 'PayPal did not accept this payout.',
      batch: failed,
    };
  }
}

/**
 * Brings a batch up to date: one whose creation went unanswered is sent again with the same
 * request id (PayPal returns its first answer); the others are read back.
 */
export async function refreshBatch(
  ctx: PayoutContext,
  batch: PayoutBatchRecord,
): Promise<PayoutBatchRecord> {
  if (batch.paypalBatchId === null) {
    if (batch.status !== 'unknown') return batch;
    const sent = await sendBatch(ctx, batch);
    return sent.batch ?? batch;
  }
  try {
    return await record(ctx, batch, await ctx.payouts.getBatch(batch.paypalBatchId));
  } catch (error) {
    const failure = toPayPalError('payouts.get', error);
    return write(ctx, batch, batch.status, null, describeFailure(failure));
  }
}

function record(ctx: PayoutContext, batch: PayoutBatchRecord, answer: PayoutBatch) {
  const status = STATUS[answer.batch_header.batch_status];
  return write(ctx, batch, status, answer.batch_header.payout_batch_id, null);
}

async function write(
  ctx: PayoutContext,
  batch: PayoutBatchRecord,
  status: PayoutStatus,
  paypalBatchId: string | null,
  detail: string | null,
): Promise<PayoutBatchRecord> {
  const now = ctx.clock.now();
  const settled =
    status === 'success' || status === 'denied' || status === 'canceled' || status === 'failed';
  const updated = await ctx.write((tx) =>
    payoutLedger.update(
      tx,
      batch,
      {
        status,
        ...(paypalBatchId === null ? {} : { paypalBatchId }),
        detail,
        nextCheckAt: settled ? null : new Date(now.getTime() + LOOK_AGAIN_MS),
      },
      now,
    ),
  );
  return updated ?? batch;
}
