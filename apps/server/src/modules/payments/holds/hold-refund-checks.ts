import { describeFailure } from '../context.js';
import { toPayPalError } from '../paypal/errors.js';
import type { PayPalRefund } from '../paypal/schemas.js';
import { holdRefundReference, holdRequestId, type HoldContext } from './hold-context.js';
import { holdLedger, type HoldRecord } from './hold-ledger.js';
import { refundState, refundStore, type HoldRefundRecord } from './hold-refund-store.js';

const DAY_MS = 24 * 60 * 60_000;

/**
 * PayPal keeps a refund's PayPal-Request-Id for 45 days (developer.paypal.com/api/rest/requests/,
 * `PayPal-Request-Id`); MovIQ asks again under it for one day less, so the key is never asked
 * for once PayPal may have forgotten it.
 */
export const REFUND_ASKED_AGAIN_FOR_MS = 44 * DAY_MS;

/** What the control room reads on a refund only a person can finish. */
export const REFUND_NEEDS_A_PERSON =
  'PayPal lists no refund for this operation and no longer keeps its request id: ' +
  'check the capture in PayPal before refunding it by hand.';

/**
 * Follows a refund PayPal has not confirmed to its end, whatever the hold's own status. A refund
 * with PayPal's id is read back. One without it (its answer never arrived) is looked for in the
 * order by its own `custom_id`, never by its amount, so a refund PayPal made is never asked for
 * again nor taken for another; only if PayPal lists none is it asked again, under its own
 * request id, while PayPal keeps it. Past that, it is left open for a person.
 */
export async function checkRefund(ctx: HoldContext, refund: HoldRefundRecord): Promise<void> {
  const hold = await holdLedger.find(ctx.db, refund.holdId);
  if (hold === undefined || hold.paypalCaptureId === null) {
    throw new Error(`Refund ${refund.operation} of hold ${refund.holdId} has no capture.`);
  }
  const checks = refund.checks + 1;
  try {
    const answer =
      refund.paypalRefundId === null
        ? await findOrAsk(ctx, hold, refund)
        : await ctx.paypal.getRefund(refund.paypalRefundId);
    if (answer === 'needs-a-person') {
      ctx.logger.error('refund needs a person', { holdId: hold.id, operation: refund.operation });
      await settle(ctx, { ...refund, checks }, 'unknown', null, REFUND_NEEDS_A_PERSON);
      return;
    }
    await settle(ctx, { ...refund, checks }, refundState(answer), answer.id, null);
  } catch (error) {
    const failure = toPayPalError('refunds.check', error);
    const detail = describeFailure(failure);
    ctx.logger.warn('refund left for the next look', { holdId: hold.id, detail });
    // Only PayPal refusing the refund itself ends it; any other failure is looked at again.
    const turnedAway = failure.operation === 'captures.refund' && failure.outcome === 'refused';
    await settle(ctx, { ...refund, checks }, turnedAway ? 'failed' : 'unknown', null, detail);
  }
}

async function findOrAsk(
  ctx: HoldContext,
  hold: HoldRecord,
  refund: HoldRefundRecord,
): Promise<PayPalRefund | 'needs-a-person'> {
  const reference = holdRefundReference(hold, refund.operation);
  const order = await ctx.paypal.getOrder(hold.paypalOrderId ?? '');
  const made = (order.purchase_units ?? [])
    .flatMap((unit) => unit.payments?.refunds ?? [])
    .find((candidate) => candidate.custom_id === reference);
  if (made !== undefined) return made;
  const keyKept = ctx.clock.now().getTime() - refund.askedAt.getTime() < REFUND_ASKED_AGAIN_FOR_MS;
  if (!keyKept) return 'needs-a-person';
  return ctx.paypal.refundCapture(hold.paypalCaptureId ?? '', {
    amount: refund.amount,
    customId: reference,
    requestId: holdRequestId(hold, `refund:${refund.operation}`),
  });
}

function settle(
  ctx: HoldContext,
  refund: HoldRefundRecord,
  status: HoldRefundRecord['status'],
  paypalRefundId: string | null,
  detail: string | null,
): Promise<void> {
  return ctx.write((tx) =>
    refundStore.settle(tx, refund, { status, paypalRefundId, detail }, ctx.clock.now()),
  );
}
