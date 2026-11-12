import type { Money, ScanRefusalReason } from '@moviq/contracts';

import type { Secret } from '../../config/secret.js';
import { decideAgainWhenStale, type HoldContext } from '../payments/holds/hold-context.js';
import { holdLedger } from '../payments/holds/hold-ledger.js';
import { refundHold } from '../payments/holds/hold-refunds.js';
import { captureHold } from '../payments/holds/hold-steps.js';
import { conversations } from './conversation.js';
import { offerStore } from './offers-store.js';
import { orderStore, type OrderRecord } from './orders-store.js';
import { checkCode } from './pickup-code.js';

export type ScanOutcome =
  | { readonly kind: 'charged'; readonly order: OrderRecord; readonly amount: Money }
  | { readonly kind: 'confirming'; readonly order: OrderRecord; readonly message: string }
  | {
      readonly kind: 'refused';
      readonly status: 403 | 404 | 409;
      readonly reason: ScanRefusalReason;
      readonly message: string;
    };

const refused = (
  status: 403 | 404 | 409,
  reason: ScanRefusalReason,
  message: string,
): ScanOutcome => ({ kind: 'refused', status, reason, message });

const CODE_REASONS = {
  malformed: 'not-moviq',
  forged: 'not-moviq',
  expired: 'expired',
  used: 'used',
} as const satisfies Record<string, ScanRefusalReason>;

const COLLECTABLE: ReadonlySet<OrderRecord['status']> = new Set(['reserved', 'preparing', 'ready']);

/**
 * The counter scans the traveller's code: if it is MovIQ's, unexpired, unused and for one of
 * this merchant's orders, the held money is captured, and the order is handed over only once
 * PayPal confirms the charge. Scanning again never charges twice.
 */
export async function scanCode(
  ctx: HoldContext,
  input: { readonly merchantId: string; readonly code: string; readonly secret: Secret },
): Promise<ScanOutcome> {
  const checked = await checkCode(ctx.db, input.secret, input.code, ctx.clock.now());
  if (!checked.ok) return refused(409, CODE_REASONS[checked.reason], checked.message);
  const order = await orderStore.find(ctx.db, checked.orderId);
  if (order === undefined) return refused(404, 'no-order', 'There is no order for this code.');
  if (order.merchantId !== input.merchantId) {
    return refused(403, 'other-merchant', 'This code is for another merchant.');
  }
  if (!COLLECTABLE.has(order.status)) {
    return refused(
      409,
      order.status === 'cancelled' ? 'cancelled' : 'used',
      `Order ${order.code} cannot be collected: it is ${order.status}.`,
    );
  }
  const outcome = await decideAgainWhenStale(async () => {
    const hold = await holdLedger.find(ctx.db, order.holdId);
    if (hold === undefined) throw new Error(`Order ${order.id} has no hold.`);
    return captureHold(ctx, hold);
  });
  if (!outcome.ok) {
    const reason =
      outcome.reason === 'unavailable'
        ? 'paypal-unavailable'
        : outcome.hold?.status === 'created'
          ? 'unconfirmed'
          : 'not-charged';
    return refused(409, reason, outcome.message);
  }
  const latest = (await orderStore.find(ctx.db, order.id)) ?? order;
  if (outcome.hold.status === 'captured') {
    return {
      kind: 'charged',
      order: latest,
      amount: { amountMinor: outcome.hold.capturedMinor, currency: 'USD' },
    };
  }
  return {
    kind: 'confirming',
    order: latest,
    message: 'PayPal is still confirming the charge. Scan again in a moment.',
  };
}

export interface RefundAnswer {
  readonly ok: boolean;
  readonly message: string;
  /** Given back: PayPal confirmed it. */
  readonly refunded: Money;
  /** Asked for and not confirmed by PayPal yet; reconciliation follows it to its end. */
  readonly pending: Money;
}

const MISSING_MESSAGES = {
  refunded: 'Refunded through PayPal.',
  pending:
    'PayPal has not confirmed this refund yet. It shows as refunded once PayPal confirms it.',
  nothing: 'There is nothing to refund for those lines.',
  alreadyRefunded: 'Those lines were already refunded through PayPal: nothing more is refunded.',
  alreadyPending:
    'Those lines are already being refunded: PayPal has not confirmed it yet, nothing more is asked.',
} as const;

/**
 * Something was missing at the counter: what the traveller paid for those lines goes back
 * through PayPal, each line at most once. Only what PayPal confirmed is said to be refunded.
 */
export async function refundMissing(
  ctx: HoldContext,
  order: OrderRecord,
  lineIndexes: readonly number[],
): Promise<RefundAnswer> {
  const hold = await holdLedger.find(ctx.db, order.holdId);
  if (hold === undefined || order.status !== 'picked_up') {
    return answer(false, 'Only a collected order can be refunded.', 0, 0);
  }
  const given = { refunded: 0, pending: 0 };
  const before = { refunded: 0, pending: 0 };
  for (const index of new Set(lineIndexes)) {
    const line = order.ticket[index];
    if (line === undefined || line.paidMinor === 0) continue;
    const outcome = await refundHold(ctx, hold, {
      operation: `missing:${String(index)}`,
      amount: usd(line.paidMinor),
    });
    if (!outcome.ok) return answer(false, outcome.message, given.refunded, given.pending);
    // A line asked before is said apart and never told or counted again.
    const tally = outcome.fresh ? given : before;
    if (outcome.status === 'completed') tally.refunded += line.paidMinor;
    else tally.pending += line.paidMinor;
  }
  if (given.refunded + given.pending === 0) return nothingNew(before);
  if (given.refunded > 0) await tellRefunded(ctx, order, given.refunded);
  const message = given.pending > 0 ? MISSING_MESSAGES.pending : MISSING_MESSAGES.refunded;
  return answer(true, message, given.refunded, given.pending);
}

/** No line was refunded now: said as already refunded, already under way, or nothing to refund. */
function nothingNew(before: { readonly refunded: number; readonly pending: number }): RefundAnswer {
  if (before.pending > 0) return answer(false, MISSING_MESSAGES.alreadyPending, 0, 0);
  if (before.refunded > 0) return answer(false, MISSING_MESSAGES.alreadyRefunded, 0, 0);
  return answer(false, MISSING_MESSAGES.nothing, 0, 0);
}

async function tellRefunded(ctx: HoldContext, order: OrderRecord, amountMinor: number) {
  const offer = await offerStore.find(ctx.db, order.offerId);
  if (offer === undefined) return;
  await ctx.write((tx) =>
    conversations.append(
      tx,
      offer.threadId,
      { type: 'payment', from: 'server', step: 'refunded', amount: usd(amountMinor) },
      ctx.clock.now(),
    ),
  );
}

const answer = (ok: boolean, message: string, refunded: number, pending: number): RefundAnswer => ({
  ok,
  message,
  refunded: usd(refunded),
  pending: usd(pending),
});

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });
