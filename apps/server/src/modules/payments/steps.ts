import type { Transaction } from '@libsql/client';

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
import { paymentLedger, type PaymentRecord } from './ledger.js';
import { toPayPalError } from './paypal/errors.js';
import type { PayPalCapture, PayPalRefund } from './paypal/schemas.js';

/** The operation name of the refund given when a paid purchase cannot be applied. */
const UNAPPLIED_REFUND = 'refund:unapplied';

/**
 * Opens the PayPal order of a payment still waiting for one. A retry sends the same request id
 * and the same body, so PayPal returns the order it may already have created.
 */
export async function openOrder(
  ctx: PaymentContext,
  payment: PaymentRecord,
  billingAgreementId?: string,
): Promise<Outcome> {
  let orderId: string;
  let paypalStatus: string | null;
  try {
    const order = await ctx.paypal.createOrder({
      intent: 'CAPTURE',
      amount: payment.amount,
      description: payment.description,
      referenceId: payment.id,
      requestId: requestId(payment, 'create'),
      ...(billingAgreementId === undefined ? {} : { billingAgreementId }),
    });
    orderId = order.id;
    paypalStatus = order.status ?? null;
  } catch (error) {
    const failure = toPayPalError('orders.create', error);
    if (failure.outcome !== 'refused') return unavailable(await postpone(ctx, payment, failure));
    await change(ctx, payment, {
      status: 'failed',
      pending: null,
      detail: describeFailure(failure),
      nextCheckAt: null,
    });
    return refused(MESSAGES.refusedByPayPal);
  }
  if (billingAgreementId !== undefined) {
    // PayPal charges an order opened on an agreement as it opens it: the capture is under way
    // and is recorded when the order is read back, never taken from this answer.
    const charging = await change(ctx, payment, {
      status: 'unknown',
      pending: 'capture',
      paypalOrderId: orderId,
      paypalStatus,
      detail: null,
      nextCheckAt: nextCheck('unknown', 0, ctx.clock.now()),
    });
    return ok(charging);
  }
  const created = await change(ctx, payment, {
    status: 'created',
    pending: null,
    paypalOrderId: orderId,
    paypalStatus,
    detail: null,
    nextCheckAt: nextCheck('created', 0, ctx.clock.now()),
  });
  return ok(created);
}

/**
 * The money was captured but the purchase could not be applied: it is refunded in full, under
 * one operation, so a repeat never refunds twice.
 */
export async function refundUnapplied(
  ctx: PaymentContext,
  payment: PaymentRecord,
  capture: PayPalCapture,
  reason: string,
): Promise<Outcome> {
  const marked =
    payment.pending === 'refund'
      ? payment
      : await change(ctx, payment, {
          status: 'unknown',
          pending: 'refund',
          paypalCaptureId: capture.id,
          paypalStatus: capture.status,
          detail: reason,
          nextCheckAt: nextCheck('unknown', 0, ctx.clock.now()),
        });
  let refund;
  try {
    refund = await ctx.paypal.refundCapture(capture.id, {
      requestId: requestId(payment, UNAPPLIED_REFUND),
    });
  } catch (error) {
    const failure = toPayPalError('captures.refund', error);
    ctx.logger.error('refund of an unapplied payment did not complete', {
      paymentId: payment.id,
      outcome: failure.outcome,
      issue: failure.issue,
    });
    return refused(MESSAGES.refunding, await postpone(ctx, marked, failure));
  }
  if (refund.status !== 'COMPLETED') {
    const checks = marked.checks + 1;
    const waiting = await change(ctx, marked, {
      paypalStatus: `REFUND_${refund.status}`,
      checks,
      nextCheckAt: nextCheck('unknown', checks, ctx.clock.now()),
    });
    return refused(MESSAGES.refunding, waiting);
  }
  const refunded = await ctx.write(async (tx) => {
    const now = ctx.clock.now();
    await paymentLedger.recordRefund(
      tx,
      {
        paymentId: payment.id,
        operation: UNAPPLIED_REFUND,
        paypalRefundId: refund.id,
        amount: refund.amount ?? payment.amount,
        paypalStatus: refund.status,
      },
      now,
    );
    return paymentLedger.update(
      tx,
      marked,
      { status: 'refunded', pending: null, paypalStatus: 'REFUNDED', nextCheckAt: null },
      ctx.source,
      now,
    );
  });
  return refused(MESSAGES.refunded, refunded);
}

/** PayPal reports the capture refunded in full: each refund is recorded once, and it closes. */
export async function recordRefunded(
  ctx: PaymentContext,
  payment: PaymentRecord,
  capture: PayPalCapture,
  refunds: readonly PayPalRefund[],
): Promise<PaymentRecord> {
  return ctx.write(async (tx) => {
    await recordRefunds(ctx, tx, payment, refunds);
    return paymentLedger.update(
      tx,
      payment,
      {
        status: 'refunded',
        pending: null,
        paypalCaptureId: capture.id,
        paypalStatus: capture.status,
        nextCheckAt: null,
      },
      ctx.source,
      ctx.clock.now(),
    );
  });
}

/** Records the completed refunds PayPal lists, each once whatever repeats it. */
export async function recordRefunds(
  ctx: PaymentContext,
  tx: Transaction,
  payment: PaymentRecord,
  refunds: readonly PayPalRefund[],
): Promise<void> {
  for (const refund of refunds) {
    if (refund.status !== 'COMPLETED' || refund.amount === undefined) continue;
    await paymentLedger.recordRefund(
      tx,
      {
        paymentId: payment.id,
        operation: `paypal:${refund.id}`,
        paypalRefundId: refund.id,
        amount: refund.amount,
        paypalStatus: refund.status,
      },
      ctx.clock.now(),
    );
  }
}
