import { LibsqlError } from '@libsql/client';

import { DatabaseBusyError } from '../../../infrastructure/database/database.js';
import { RowShapeError } from '../../../infrastructure/database/rows.js';
import { LeaseLostError } from '../../../infrastructure/jobs/leadership.js';
import { describeFailure } from '../context.js';
import { toPayPalError } from '../paypal/errors.js';
import type { PayPalAuthorization, PayPalCapture } from '../paypal/schemas.js';
import {
  changeHold,
  HOLD_MESSAGES,
  holdOk,
  holdRefused,
  holdRequestId,
  nextHoldCheck,
  postponeHold,
  type HoldContext,
  type HoldOutcome,
} from './hold-context.js';
import { holdLedger, HoldTransitionError, StaleHoldError, type HoldRecord } from './hold-ledger.js';
import { releaseStore } from './hold-release-store.js';

/**
 * Records what PayPal confirmed and applies the purchase in the same transaction. Nothing is
 * applied before PayPal's answer says the money is held, charged or released.
 */

/** PayPal holds the money: the purchase is applied, or, if it cannot be, the hold is voided. */
export async function applyAuthorized(
  ctx: HoldContext,
  hold: HoldRecord,
  authorization: PayPalAuthorization,
): Promise<HoldOutcome> {
  if (hold.status === 'authorized') return holdOk(hold);
  try {
    const authorized = await ctx.write(async (tx) => {
      const updated = await holdLedger.update(
        tx,
        hold,
        {
          status: 'authorized',
          pending: null,
          paypalAuthorizationId: authorization.id,
          paypalStatus: authorization.status,
          detail: null,
          nextCheckAt: null,
        },
        ctx.source,
        ctx.clock.now(),
      );
      await ctx.purchases.authorized(hold.purpose, hold.id, tx);
      return updated;
    });
    return holdOk(authorized);
  } catch (error) {
    if (isInfrastructureFailure(error)) throw error;
    const reason = error instanceof Error ? error.message : 'the reservation could not be kept';
    ctx.logger.warn('hold authorized but its purchase could not be applied', { holdId: hold.id });
    return voidUnapplied(ctx, hold, authorization.id, `Not applied: ${reason}`.slice(0, 300));
  }
}

/** The money is charged: the hold is closed as captured and the purchase delivered. */
export async function applyCaptured(
  ctx: HoldContext,
  hold: HoldRecord,
  capture: PayPalCapture,
): Promise<HoldOutcome> {
  if (hold.status === 'captured') return holdOk(hold);
  const amount = capture.amount?.amountMinor;
  if (amount === undefined || amount <= 0 || amount > hold.amount.amountMinor) {
    ctx.logger.error('PayPal captured an unexpected amount', { holdId: hold.id });
    return holdOk(
      await changeHold(ctx, hold, {
        paypalCaptureId: capture.id,
        detail: 'PayPal reports a capture of an unexpected amount; not applied.',
        checks: hold.checks + 1,
        nextCheckAt: nextHoldCheck('unknown', hold.checks + 1, ctx.clock.now()),
      }),
    );
  }
  const captured = await ctx.write(async (tx) => {
    const updated = await holdLedger.update(
      tx,
      hold,
      {
        status: 'captured',
        pending: null,
        paypalCaptureId: capture.id,
        capturedMinor: amount,
        paypalStatus: capture.status,
        detail: null,
        nextCheckAt: null,
      },
      ctx.source,
      ctx.clock.now(),
    );
    await ctx.purchases.captured(hold.purpose, hold.id, tx);
    return updated;
  });
  return holdOk(captured);
}

/**
 * The money is released: the hold is closed as voided and the purchase, if it was applied,
 * cancelled. `purchases.voided` must accept a hold whose purchase was never applied.
 */
export async function applyVoided(
  ctx: HoldContext,
  hold: HoldRecord,
  paypalStatus: string,
): Promise<HoldOutcome> {
  if (hold.status === 'voided') return holdOk(hold);
  const voided = await ctx.write(async (tx) => {
    const updated = await holdLedger.update(
      tx,
      hold,
      { status: 'voided', pending: null, paypalStatus, nextCheckAt: null },
      ctx.source,
      ctx.clock.now(),
    );
    await ctx.purchases.voided(hold.purpose, hold.id, tx);
    await releaseStore.discharge(tx, hold.id, ctx.clock.now());
    return updated;
  });
  return holdOk(voided);
}

/**
 * The authorization arrived but the purchase could not be applied: the release is owed from the
 * moment the hold says so, in the same write, and voided under the same request id as any
 * cancellation, so a repeat never releases twice and a failure leaves it to reconciliation.
 */
async function voidUnapplied(
  ctx: HoldContext,
  hold: HoldRecord,
  authorizationId: string,
  reason: string,
): Promise<HoldOutcome> {
  const marked = await ctx.write(async (tx) => {
    const now = ctx.clock.now();
    const updated = await holdLedger.update(
      tx,
      hold,
      {
        status: 'unknown',
        pending: 'void',
        paypalAuthorizationId: authorizationId,
        detail: reason,
        nextCheckAt: nextHoldCheck('unknown', 0, now),
      },
      ctx.source,
      now,
    );
    await releaseStore.owe(tx, updated, reason, now);
    return updated;
  });
  try {
    await ctx.paypal.voidAuthorization(authorizationId, holdRequestId(hold, 'void'));
  } catch (error) {
    const failure = toPayPalError('authorizations.void', error);
    ctx.logger.error('void of an unapplied hold did not complete', {
      holdId: hold.id,
      detail: describeFailure(failure),
    });
    return holdRefused(HOLD_MESSAGES.releasing, await postponeHold(ctx, marked, failure));
  }
  const voided = await applyVoided(ctx, marked, 'VOIDED');
  return holdRefused(HOLD_MESSAGES.notApplied, voided.ok ? voided.hold : marked);
}

/** Failures of the ledger itself, not of the purchase: the step is retried, never undone. */
function isInfrastructureFailure(error: unknown): boolean {
  return (
    error instanceof StaleHoldError ||
    error instanceof HoldTransitionError ||
    error instanceof LeaseLostError ||
    error instanceof DatabaseBusyError ||
    error instanceof RowShapeError ||
    error instanceof LibsqlError
  );
}
