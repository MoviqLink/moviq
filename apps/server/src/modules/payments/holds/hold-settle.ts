import { toPayPalError } from '../paypal/errors.js';
import type { PayPalOrder } from '../paypal/schemas.js';
import { applyAuthorized, applyCaptured, applyVoided } from './hold-apply.js';
import {
  changeHold,
  HOLD_MESSAGES,
  holdOk,
  holdRefused,
  holdUnavailable,
  nextHoldCheck,
  postponeHold,
  type HoldContext,
  type HoldOutcome,
} from './hold-context.js';
import type { HoldRecord } from './hold-ledger.js';
import { readHoldOrder, type HoldReading } from './hold-reading.js';

const CLOSED: ReadonlySet<HoldRecord['status']> = new Set(['captured', 'voided', 'failed']);

/**
 * Brings a hold up to date with PayPal: the order is read back and what it shows is recorded.
 * A call whose answer was lost is settled by what PayPal did; one PayPal never acted on puts
 * the hold back where it was. Nothing is sent again from here.
 */
export async function settleHold(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  if (CLOSED.has(hold.status)) return holdOk(hold);
  if (hold.paypalOrderId === null) return holdRefused(HOLD_MESSAGES.settingUp, hold);
  let order: PayPalOrder;
  try {
    order = await ctx.paypal.getOrder(hold.paypalOrderId);
  } catch (error) {
    const failure = toPayPalError('orders.get', error);
    if (failure.outcome === 'refused' && failure.status === 404) return lapse(ctx, hold);
    return holdUnavailable(await postponeHold(ctx, hold, failure));
  }
  return recordReading(ctx, hold, readHoldOrder(order));
}

export async function recordReading(
  ctx: HoldContext,
  hold: HoldRecord,
  reading: HoldReading,
): Promise<HoldOutcome> {
  switch (reading.kind) {
    case 'authorized':
      if (hold.pending === 'capture' || hold.pending === 'void')
        return holdOk(await backTo(ctx, hold));
      return applyAuthorized(ctx, hold, reading.authorization);
    case 'captured':
      return applyCaptured(ctx, hold, reading.capture);
    case 'voided':
      return applyVoided(ctx, hold, reading.paypalStatus);
    case 'denied':
      if (hold.pending === 'capture') {
        return holdRefused(HOLD_MESSAGES.declined, await backTo(ctx, hold, reading.paypalStatus));
      }
      return holdRefused(HOLD_MESSAGES.declined, await fail(ctx, hold, reading.paypalStatus));
    case 'approved':
      return holdOk(
        await changeHold(ctx, hold, {
          status: 'created',
          pending: null,
          paypalStatus: 'APPROVED',
          nextCheckAt: nextHoldCheck('unknown', 0, ctx.clock.now()),
        }),
      );
    case 'awaiting-buyer':
      return holdRefused(HOLD_MESSAGES.approveFirst, await waitForBuyer(ctx, hold, reading));
    case 'pending':
    case 'unclear':
      return holdOk(await lookLater(ctx, hold, reading));
  }
}

/** The call PayPal never acted on: the hold is again what PayPal last confirmed. */
function backTo(ctx: HoldContext, hold: HoldRecord, paypalStatus?: string): Promise<HoldRecord> {
  const status = hold.paypalAuthorizationId === null ? 'created' : 'authorized';
  return changeHold(ctx, hold, {
    status,
    pending: null,
    ...(paypalStatus === undefined ? {} : { paypalStatus }),
    nextCheckAt: nextHoldCheck(status, 0, ctx.clock.now()),
  });
}

function waitForBuyer(
  ctx: HoldContext,
  hold: HoldRecord,
  reading: Extract<HoldReading, { kind: 'awaiting-buyer' }>,
): Promise<HoldRecord> {
  const checks = hold.status === 'unknown' ? 0 : hold.checks + 1;
  return changeHold(ctx, hold, {
    status: 'created',
    pending: null,
    paypalStatus: reading.paypalStatus,
    checks,
    nextCheckAt: nextHoldCheck('created', checks, ctx.clock.now()),
  });
}

function lookLater(
  ctx: HoldContext,
  hold: HoldRecord,
  reading: Extract<HoldReading, { kind: 'pending' | 'unclear' }>,
): Promise<HoldRecord> {
  if (reading.kind === 'unclear') {
    ctx.logger.error('PayPal order could not be read safely', { holdId: hold.id });
  }
  const checks = hold.checks + 1;
  return changeHold(ctx, hold, {
    ...(reading.kind === 'pending'
      ? { paypalStatus: reading.paypalStatus, detail: 'PayPal is still reviewing it.' }
      : { detail: reading.detail }),
    checks,
    nextCheckAt: nextHoldCheck('unknown', checks, ctx.clock.now()),
  });
}

function fail(ctx: HoldContext, hold: HoldRecord, paypalStatus: string): Promise<HoldRecord> {
  return changeHold(ctx, hold, {
    status: 'failed',
    pending: null,
    paypalStatus,
    nextCheckAt: null,
  });
}

/** PayPal no longer has the order: it lapsed unapproved, and nothing was held. */
async function lapse(ctx: HoldContext, hold: HoldRecord): Promise<HoldOutcome> {
  if (hold.paypalAuthorizationId !== null) return holdOk(hold);
  return holdRefused(HOLD_MESSAGES.lapsed, await fail(ctx, hold, 'NOT_FOUND'));
}
