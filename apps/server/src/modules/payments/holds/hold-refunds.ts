import { toInstant, type Money } from '@moviq/contracts';
import { z } from 'zod';

import { parseRow } from '../../../infrastructure/database/rows.js';
import { describeFailure } from '../context.js';
import { toPayPalError } from '../paypal/errors.js';
import {
  holdRefundReference,
  holdRequestId,
  nextHoldCheck,
  type HoldContext,
} from './hold-context.js';
import type { HoldRecord } from './hold-ledger.js';
import { refundState, refundStore, type RefundState } from './hold-refund-store.js';

/** `pending`: PayPal has not confirmed it yet; reconciliation follows it until it does. */
export type RefundOutcome =
  | {
      readonly ok: true;
      readonly status: 'completed' | 'pending';
      readonly amount: Money;
      /** False when this refund had been asked before: nothing new was asked of PayPal now. */
      readonly fresh: boolean;
    }
  | { readonly ok: false; readonly reason: 'refused' | 'unavailable'; readonly message: string };

const rowSchema = z.object({
  amount_minor: z.number().int().positive(),
  status: z.enum(['unknown', 'completed', 'failed']),
});

const totalSchema = z.object({ total: z.number().int().nonnegative() });

/**
 * Gives back part of a captured hold, such as a missing line. The operation names what is
 * refunded: it is written before PayPal is asked and is the PayPal-Request-Id and, digested, the
 * refund's `custom_id`, so the same refund is never given twice, nor mistaken for another, and
 * the total never exceeds what was charged.
 */
export async function refundHold(
  ctx: HoldContext,
  hold: HoldRecord,
  input: { readonly operation: string; readonly amount: Money },
): Promise<RefundOutcome> {
  if (hold.status !== 'captured' || hold.paypalCaptureId === null) {
    return { ok: false, reason: 'refused', message: 'Only a charged order can be refunded.' };
  }
  const recorded = await recordIntent(ctx, hold, input);
  if (recorded === 'too-much') {
    return { ok: false, reason: 'refused', message: 'This is more than is left to refund.' };
  }
  if (recorded === 'completed' || recorded === 'pending') {
    return { ok: true, status: recorded, amount: input.amount, fresh: false };
  }
  try {
    const refund = await ctx.paypal.refundCapture(hold.paypalCaptureId, {
      amount: input.amount,
      customId: holdRefundReference(hold, input.operation),
      requestId: holdRequestId(hold, `refund:${input.operation}`),
    });
    const status = refundState(refund);
    await settleIntent(ctx, hold, input.operation, {
      status,
      paypalRefundId: refund.id,
      detail: null,
    });
    if (status === 'failed') {
      return { ok: false, reason: 'refused', message: 'PayPal did not complete this refund.' };
    }
    return {
      ok: true,
      status: status === 'completed' ? 'completed' : 'pending',
      amount: input.amount,
      fresh: true,
    };
  } catch (error) {
    const failure = toPayPalError('captures.refund', error);
    if (failure.outcome === 'unknown') {
      return { ok: true, status: 'pending', amount: input.amount, fresh: true };
    }
    await settleIntent(ctx, hold, input.operation, {
      status: 'failed',
      paypalRefundId: null,
      detail: describeFailure(failure),
    });
    return failure.outcome === 'refused'
      ? { ok: false, reason: 'refused', message: 'PayPal refused this refund.' }
      : { ok: false, reason: 'unavailable', message: 'PayPal is not available right now.' };
  }
}

/** Writes the refund before asking PayPal; only a failed one may be asked again. */
async function recordIntent(
  ctx: HoldContext,
  hold: HoldRecord,
  input: { readonly operation: string; readonly amount: Money },
): Promise<'ask' | 'completed' | 'pending' | 'too-much'> {
  return ctx.write(async (tx) => {
    const existing = await tx.execute({
      sql: 'SELECT amount_minor, status FROM payment_hold_refunds WHERE hold_id = ? AND operation = ?',
      args: [hold.id, input.operation],
    });
    const row = existing.rows[0];
    const previous =
      row === undefined ? undefined : parseRow(rowSchema, row, 'payment_hold_refunds');
    if (previous?.status === 'completed') return 'completed';
    // Already asked and not confirmed yet: reconciliation follows it, nobody asks twice.
    if (previous?.status === 'unknown') return 'pending';
    const others = await tx.execute({
      sql: `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment_hold_refunds
            WHERE hold_id = ? AND operation <> ? AND status IN ('unknown', 'completed')`,
      args: [hold.id, input.operation],
    });
    const given = parseRow(totalSchema, others.rows[0], 'payment_hold_refunds').total;
    if (input.amount.amountMinor <= 0 || given + input.amount.amountMinor > hold.capturedMinor) {
      return 'too-much';
    }
    const now = toInstant(ctx.clock.now());
    const firstLook = toInstant(nextHoldCheck('unknown', 0, ctx.clock.now()) ?? ctx.clock.now());
    await tx.execute({
      sql: `INSERT INTO payment_hold_refunds (hold_id, operation, amount_minor, currency, status,
              checks, next_check_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'unknown', 0, ?, ?, ?)
            ON CONFLICT (hold_id, operation) DO UPDATE SET status = 'unknown', checks = 0,
              next_check_at = excluded.next_check_at, updated_at = excluded.updated_at`,
      args: [
        hold.id,
        input.operation,
        input.amount.amountMinor,
        input.amount.currency,
        firstLook,
        now,
        now,
      ],
    });
    return 'ask';
  });
}

function settleIntent(
  ctx: HoldContext,
  hold: HoldRecord,
  operation: string,
  result: {
    readonly status: RefundState;
    readonly paypalRefundId: string | null;
    readonly detail: string | null;
  },
): Promise<void> {
  return ctx.write((tx) =>
    refundStore.settle(tx, { holdId: hold.id, operation, checks: 0 }, result, ctx.clock.now()),
  );
}
