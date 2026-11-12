import { describeFailure } from '../context.js';
import { toPayPalError, type PayPalError } from '../paypal/errors.js';
import { applyCaptured, applyVoided } from './hold-apply.js';
import {
  changeHold,
  HOLD_MESSAGES,
  holdOk,
  holdRefused,
  holdRequestId,
  holdUnavailable,
  nextHoldCheck,
  postponeHold,
  restoreHold,
  type HoldContext,
  type HoldOutcome,
} from './hold-context.js';
import { holdLedger, type HoldRecord } from './hold-ledger.js';
import { readAuthorization, readCapture, readHoldOrder } from './hold-reading.js';
import { recordReading, settleHold } from './hold-settle.js';

/** A new hold opens its order at once; reconciliation steps in only if that is lost. */
const FIRST_CHECK_MS = 2 * 60_000;

/**
 * Starts a hold for a purchase priced by the server. The same purchase reuses its live hold, so
 * a repeated reservation never opens a second PayPal order.
 */
export async function startHold(
  ctx: HoldContext,
  input: Parameters<typeof holdLedger.insert>[1],
): Promise<HoldOutcome> {
  const hold = await ctx.write(async (tx) => {
    const open = await holdLedger.findOpen(tx, input.travellerId, input.purpose);
    if (open !== undefined) return open;
    const now = ctx.clock.now();
    return holdLedger.insert(tx, input, new Date(now.getTime() + FIRST_CHECK_MS), now);
  });
  return hold.pending === 'create' ? openHoldOrder(ctx, hold) : holdOk(hold);
}

/** Opens the PayPal order (intent AUTHORIZE) of a hold still waiting for one. */
export async function openHoldOrder(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  try {
    const order = await ctx.paypal.createOrder({
      intent: 'AUTHORIZE',
      amount: hold.amount,
      presentation: hold.presentation,
      description: hold.description,
      referenceId: hold.id,
      requestId: holdRequestId(hold, 'create'),
    });
    const created = await changeHold(ctx, hold, {
      status: 'created',
      pending: null,
      paypalOrderId: order.id,
      paypalStatus: order.status ?? null,
      detail: null,
      nextCheckAt: nextHoldCheck('created', 0, ctx.clock.now()),
    });
    return holdOk(created);
  } catch (error) {
    const failure = toPayPalError('orders.create', error);
    if (failure.outcome !== 'refused')
      return holdUnavailable(await postponeHold(ctx, hold, failure));
    const failed = await changeHold(ctx, hold, {
      status: 'failed',
      pending: null,
      detail: describeFailure(failure),
      nextCheckAt: null,
    });
    return holdRefused(HOLD_MESSAGES.refusedByPayPal, failed);
  }
}

/**
 * Asks PayPal to hold the money of an approved order. The intent is recorded first, so a lost
 * answer leaves a hold reconciliation knows to read back; the purchase is applied only with
 * PayPal's authorization.
 */
export async function authorizeHold(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  if (hold.status === 'authorized' || hold.status === 'captured') return holdOk(hold);
  if (hold.status === 'voided' || hold.status === 'failed') {
    return holdRefused(HOLD_MESSAGES.closed, hold);
  }
  if (hold.status === 'unknown') {
    return hold.pending === 'create'
      ? holdRefused(HOLD_MESSAGES.settingUp, hold)
      : settleHold(ctx, hold);
  }
  const sent = await changeHold(ctx, hold, {
    status: 'unknown',
    pending: 'authorize',
    detail: null,
    nextCheckAt: nextHoldCheck('unknown', 0, ctx.clock.now()),
  });
  try {
    const order = await ctx.paypal.authorizeOrder(
      hold.paypalOrderId ?? '',
      holdRequestId(hold, 'authorize'),
    );
    return await recordReading(ctx, sent, readHoldOrder(order));
  } catch (error) {
    return authorizeFailed(ctx, sent, toPayPalError('orders.authorize', error));
  }
}

async function authorizeFailed(
  ctx: HoldContext,
  sent: HoldRecord,
  failure: PayPalError,
): Promise<HoldOutcome> {
  if (failure.outcome === 'unknown') return holdOk(await postponeHold(ctx, sent, failure));
  if (failure.outcome === 'not_done') {
    return holdUnavailable(await restoreHold(ctx, sent, 'created', failure));
  }
  if (failure.is('ORDER_NOT_APPROVED') || failure.is('PAYER_ACTION_REQUIRED')) {
    return holdRefused(
      HOLD_MESSAGES.approveFirst,
      await restoreHold(ctx, sent, 'created', failure),
    );
  }
  // Refused for another reason (declined, already authorized): PayPal's record has the last word.
  return settleHold(
    ctx,
    await changeHold(ctx, sent, { detail: describeFailure(failure), nextCheckAt: null }),
  );
}

/**
 * Charges the held money, all of it, and releases nothing more. Repeating it never charges twice:
 * a captured hold is returned as it is, and the retry carries the same request id.
 */
export async function captureHold(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  if (hold.status === 'captured') return holdOk(hold);
  if (hold.status === 'unknown') return settleHold(ctx, hold);
  if (hold.status !== 'authorized' || hold.paypalAuthorizationId === null) {
    return holdRefused(HOLD_MESSAGES.notHeld, hold);
  }
  const sent = await changeHold(ctx, hold, {
    status: 'unknown',
    pending: 'capture',
    detail: null,
    nextCheckAt: nextHoldCheck('unknown', 0, ctx.clock.now()),
  });
  try {
    const capture = await ctx.paypal.captureAuthorization(hold.paypalAuthorizationId, {
      finalCapture: true,
      requestId: holdRequestId(hold, 'capture'),
    });
    const reading = readCapture(capture);
    return reading.kind === 'captured'
      ? await applyCaptured(ctx, sent, reading.capture)
      : await recordReading(ctx, sent, reading);
  } catch (error) {
    return releaseFailed(ctx, sent, toPayPalError('authorizations.capture', error));
  }
}

/** Releases the held money. Only an authorized hold has anything to release in PayPal. */
export async function voidHold(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  if (hold.status === 'voided') return holdOk(hold);
  if (hold.status === 'captured') return holdRefused(HOLD_MESSAGES.alreadyCaptured, hold);
  if (hold.status === 'unknown') return settleHold(ctx, hold);
  if (hold.status === 'created') return applyVoided(ctx, hold, 'NOT_AUTHORIZED');
  if (hold.status !== 'authorized' || hold.paypalAuthorizationId === null) {
    return holdRefused(HOLD_MESSAGES.closed, hold);
  }
  const sent = await changeHold(ctx, hold, {
    status: 'unknown',
    pending: 'void',
    detail: null,
    nextCheckAt: nextHoldCheck('unknown', 0, ctx.clock.now()),
  });
  try {
    const voided = await ctx.paypal.voidAuthorization(
      hold.paypalAuthorizationId,
      holdRequestId(hold, 'void'),
    );
    return voided === undefined
      ? await applyVoided(ctx, sent, 'VOIDED')
      : await recordReading(ctx, sent, readAuthorization(voided));
  } catch (error) {
    return releaseFailed(ctx, sent, toPayPalError('authorizations.void', error));
  }
}

/** A capture or a void that failed: unknown waits, not done goes back, refused reads back. */
async function releaseFailed(
  ctx: HoldContext,
  sent: HoldRecord,
  failure: PayPalError,
): Promise<HoldOutcome> {
  if (failure.outcome === 'unknown') return holdOk(await postponeHold(ctx, sent, failure));
  if (failure.outcome === 'not_done') {
    return holdUnavailable(await restoreHold(ctx, sent, 'authorized', failure));
  }
  const settled = await settleHold(ctx, sent);
  if (settled.ok && settled.hold.status === 'authorized') {
    return holdRefused(HOLD_MESSAGES.notCharged, settled.hold);
  }
  return settled;
}
