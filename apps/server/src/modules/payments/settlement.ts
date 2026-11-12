import { LibsqlError } from '@libsql/client';

import { DatabaseBusyError } from '../../infrastructure/database/database.js';
import { RowShapeError } from '../../infrastructure/database/rows.js';
import { LeaseLostError } from '../../infrastructure/jobs/leadership.js';
import {
  change,
  describeFailure,
  MESSAGES,
  nextCheck,
  ok,
  postpone,
  refused,
  requestId,
  unavailable,
  type Outcome,
  type PaymentContext,
} from './context.js';
import {
  paymentLedger,
  PaymentTransitionError,
  StalePaymentError,
  type PaymentRecord,
} from './ledger.js';
import { readOrder } from './order-reading.js';
import { toPayPalError, type PayPalError } from './paypal/errors.js';
import type { PayPalCapture, PayPalOrder, PayPalRefund } from './paypal/schemas.js';
import { recordRefunded, recordRefunds, refundUnapplied } from './steps.js';

const CLOSED: ReadonlySet<PaymentRecord['status']> = new Set(['failed', 'voided', 'refunded']);

/**
 * Brings a payment up to date with PayPal: the order is read back and whatever it shows is
 * recorded, or carried on (an approved order is captured, a capture that could not be applied
 * is refunded). Used by reconciliation and by webhooks; every step is safe to repeat.
 */
export async function settle(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  // A closed payment stays closed: an approval arriving after it failed captures nothing.
  if (CLOSED.has(payment.status)) return ok(payment);
  if (payment.paypalOrderId === null) throw new Error(`Payment ${payment.id} has no order yet.`);
  let order: PayPalOrder;
  try {
    order = await ctx.paypal.getOrder(payment.paypalOrderId);
  } catch (error) {
    const failure = toPayPalError('orders.get', error);
    if (failure.outcome === 'refused' && failure.status === 404) return lapse(ctx, payment);
    return unavailable(await postpone(ctx, payment, failure));
  }
  return applyOrder(ctx, payment, order);
}

/** Checks, just before charging, that the purchase is still offered at the same price. */
export async function stillOnSale(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  const quote = await ctx.catalog.quote(payment.purpose, payment.travellerId);
  if (quote.ok && quote.amount.amountMinor === payment.amount.amountMinor) return ok(payment);
  const reason = quote.ok ? MESSAGES.priceChanged : quote.reason;
  const failed = await change(ctx, payment, {
    status: 'failed',
    pending: null,
    detail: `No longer offered at this price: ${reason}`,
    nextCheckAt: null,
  });
  return refused(reason, failed);
}

/**
 * Captures an order. The intent to capture is recorded first (`unknown`), so a crash or a lost
 * answer leaves a payment that reconciliation knows to check; the request id makes the retry
 * return PayPal's first capture instead of charging again.
 */
export async function captureOrder(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  if (payment.paypalOrderId === null) throw new Error(`Payment ${payment.id} has no order yet.`);
  const sent =
    payment.pending === 'capture'
      ? payment
      : await change(ctx, payment, {
          status: 'unknown',
          pending: 'capture',
          detail: null,
          nextCheckAt: nextCheck('unknown', 0, ctx.clock.now()),
        });
  let order: PayPalOrder;
  try {
    order = await ctx.paypal.captureOrder(payment.paypalOrderId, requestId(payment, 'capture'));
  } catch (error) {
    return captureFailed(ctx, sent, payment, toPayPalError('orders.capture', error));
  }
  return applyOrder(ctx, sent, order);
}

async function captureFailed(
  ctx: PaymentContext,
  sent: PaymentRecord,
  before: PaymentRecord,
  failure: PayPalError,
): Promise<Outcome> {
  if (failure.outcome === 'unknown') return ok(await postpone(ctx, sent, failure));
  if (failure.outcome === 'not_done') {
    if (before.status === 'unknown') return unavailable(await postpone(ctx, sent, failure));
    const restored = await change(ctx, sent, {
      status: before.status,
      pending: null,
      detail: describeFailure(failure),
      nextCheckAt: nextCheck(before.status, 0, ctx.clock.now()),
    });
    return unavailable(restored);
  }
  if (failure.status === 404) return lapse(ctx, sent);
  if (failure.is('ORDER_ALREADY_CAPTURED')) {
    return readBack(ctx, sent, async () => ok(await postpone(ctx, sent, failure)));
  }
  const awaitingBuyer = failure.is('ORDER_NOT_APPROVED') || failure.is('PAYER_ACTION_REQUIRED');
  if (awaitingBuyer || failure.is('INSTRUMENT_DECLINED')) {
    const waiting = await change(ctx, sent, {
      status: 'created',
      pending: null,
      detail: describeFailure(failure),
      nextCheckAt: nextCheck('created', 0, ctx.clock.now()),
    });
    return refused(awaitingBuyer ? MESSAGES.approveFirst : MESSAGES.instrumentDeclined, waiting);
  }
  return readBack(ctx, sent, async () => {
    const failed = await change(ctx, sent, {
      status: 'failed',
      pending: null,
      detail: describeFailure(failure),
      nextCheckAt: null,
    });
    return refused(MESSAGES.refusedByPayPal, failed);
  });
}

/**
 * After a refused capture, PayPal's own record has the last word: a capture it shows is
 * recorded, and only an order without one takes `otherwise`. It never sends a capture again.
 */
async function readBack(
  ctx: PaymentContext,
  sent: PaymentRecord,
  otherwise: () => Promise<Outcome>,
): Promise<Outcome> {
  let order: PayPalOrder;
  try {
    order = await ctx.paypal.getOrder(sent.paypalOrderId ?? '');
  } catch (error) {
    return ok(await postpone(ctx, sent, toPayPalError('orders.get', error)));
  }
  const kind = readOrder(order).kind;
  const charged = kind === 'captured' || kind === 'refunded' || kind === 'capture-pending';
  return charged || kind === 'declined' ? applyOrder(ctx, sent, order) : otherwise();
}

/** Records what the order shows, or carries it on. */
async function applyOrder(
  ctx: PaymentContext,
  payment: PaymentRecord,
  order: PayPalOrder,
): Promise<Outcome> {
  const reading = readOrder(order);
  const now = ctx.clock.now();
  switch (reading.kind) {
    case 'captured':
      return payment.pending === 'refund'
        ? refundUnapplied(ctx, payment, reading.capture, payment.detail ?? 'Not applied')
        : applyCapture(ctx, payment, reading.capture, reading.refunds);
    case 'refunded':
      return ok(await recordRefunded(ctx, payment, reading.capture, reading.refunds));
    case 'capture-pending':
      return ok(
        await change(ctx, payment, {
          paypalCaptureId: reading.capture.id,
          paypalStatus: reading.capture.status,
          detail: 'PayPal is still reviewing the payment.',
          checks: payment.checks + 1,
          nextCheckAt: nextCheck('unknown', payment.checks + 1, now),
        }),
      );
    case 'declined':
      return refused(
        MESSAGES.declined,
        await close(ctx, payment, 'failed', reading.capture.status),
      );
    case 'voided':
      return refused(MESSAGES.voided, await close(ctx, payment, 'voided', 'VOIDED'));
    case 'approved':
      return captureApproved(ctx, payment);
    case 'awaiting-buyer':
      return awaitBuyer(ctx, payment, reading.paypalStatus);
    case 'unclear':
      ctx.logger.error('PayPal order could not be read safely', { paymentId: payment.id });
      return ok(
        await change(ctx, payment, {
          detail: reading.detail,
          checks: payment.checks + 1,
          nextCheckAt: nextCheck(payment.status, payment.checks + 1, now),
        }),
      );
  }
}

/** The buyer approved the order but nobody captured it: it is captured now. */
async function captureApproved(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  if (payment.status === 'unknown') return captureOrder(ctx, payment);
  const approved =
    payment.status === 'approved'
      ? payment
      : await change(ctx, payment, {
          status: 'approved',
          paypalStatus: 'APPROVED',
          nextCheckAt: nextCheck('approved', 0, ctx.clock.now()),
        });
  const sale = await stillOnSale(ctx, approved);
  return sale.ok ? captureOrder(ctx, approved) : sale;
}

async function awaitBuyer(
  ctx: PaymentContext,
  payment: PaymentRecord,
  paypalStatus: string | null,
): Promise<Outcome> {
  if (payment.status === 'unknown') {
    // The capture never happened: the order is waiting for its buyer again.
    const waiting = await change(ctx, payment, {
      status: 'created',
      pending: null,
      paypalStatus,
      nextCheckAt: nextCheck('created', 0, ctx.clock.now()),
    });
    return refused(MESSAGES.approveFirst, waiting);
  }
  const checks = payment.checks + 1;
  const waiting = await change(ctx, payment, {
    paypalStatus,
    checks,
    nextCheckAt: nextCheck(payment.status, checks, ctx.clock.now()),
  });
  return refused(MESSAGES.approveFirst, waiting);
}

/**
 * Marks the payment captured and applies the purchase in the same transaction. If the purchase
 * cannot be applied, nothing of it is kept and the money is refunded in full.
 */
async function applyCapture(
  ctx: PaymentContext,
  payment: PaymentRecord,
  capture: PayPalCapture,
  refunds: readonly PayPalRefund[],
): Promise<Outcome> {
  if (payment.status === 'captured') {
    await ctx.write((tx) => recordRefunds(ctx, tx, payment, refunds));
    return ok(payment);
  }
  if (capture.amount?.amountMinor !== payment.amount.amountMinor) {
    ctx.logger.error('PayPal captured a different amount', { paymentId: payment.id });
    return ok(
      await change(ctx, payment, {
        paypalCaptureId: capture.id,
        detail: 'PayPal reports a capture of a different amount; not applied.',
        checks: payment.checks + 1,
        nextCheckAt: nextCheck('unknown', payment.checks + 1, ctx.clock.now()),
      }),
    );
  }
  try {
    const captured = await ctx.write(async (tx) => {
      const updated = await paymentLedger.update(
        tx,
        payment,
        {
          status: 'captured',
          pending: null,
          paypalCaptureId: capture.id,
          paypalStatus: capture.status,
          detail: null,
          nextCheckAt: null,
        },
        ctx.source,
        ctx.clock.now(),
      );
      await ctx.catalog.fulfil(payment.purpose, payment.id, tx);
      await recordRefunds(ctx, tx, payment, refunds);
      return updated;
    });
    return ok(captured);
  } catch (error) {
    if (isInfrastructureFailure(error)) throw error;
    ctx.logger.error('payment captured but its purchase could not be applied', {
      paymentId: payment.id,
      error,
    });
    const reason = error instanceof Error ? error.message : 'the purchase could not be applied';
    return refundUnapplied(ctx, payment, capture, `Not applied: ${reason}`.slice(0, 500));
  }
}

/** Failures of the ledger itself, not of the purchase: the step is retried, never refunded. */
function isInfrastructureFailure(error: unknown): boolean {
  return (
    error instanceof StalePaymentError ||
    error instanceof PaymentTransitionError ||
    error instanceof LeaseLostError ||
    error instanceof DatabaseBusyError ||
    error instanceof RowShapeError ||
    error instanceof LibsqlError
  );
}

/** PayPal no longer has the order: it lapsed without being approved, and nothing was charged. */
async function lapse(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  if (payment.status !== 'created' && payment.status !== 'approved' && payment.status !== 'unknown')
    return ok(payment);
  return refused(MESSAGES.lapsed, await close(ctx, payment, 'failed', 'NOT_FOUND'));
}

function close(
  ctx: PaymentContext,
  payment: PaymentRecord,
  status: 'failed' | 'voided',
  paypalStatus: string,
): Promise<PaymentRecord> {
  return change(ctx, payment, { status, pending: null, paypalStatus, nextCheckAt: null });
}
