import { createHash } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import type { HoldPurpose } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { Database } from '../../../infrastructure/database/database.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import { describeFailure } from '../context.js';
import type { PayPalError } from '../paypal/errors.js';
import type { PayPalGateway } from '../paypal/gateway.js';
import {
  holdLedger,
  StaleHoldError,
  type HoldChange,
  type HoldRecord,
  type HoldSource,
} from './hold-ledger.js';
import type { HoldStatus } from './hold-transitions.js';

/**
 * What a hold buys, applied by the module that sells it only once PayPal confirmed the money,
 * in the same transaction that records the confirmation. `authorized` may refuse by throwing:
 * the hold is then voided and nothing is kept.
 */
export interface HoldPurchases {
  authorized(purpose: HoldPurpose, holdId: string, tx: Transaction): Promise<void>;
  captured(purpose: HoldPurpose, holdId: string, tx: Transaction): Promise<void>;
  voided(purpose: HoldPurpose, holdId: string, tx: Transaction): Promise<void>;
}

export interface HoldContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly paypal: PayPalGateway;
  readonly purchases: HoldPurchases;
  readonly source: HoldSource;
  readonly write: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
}

/**
 * The result of a step. `refused`: it will not go ahead as asked (the message says why).
 * `unavailable`: PayPal could not be reached and nothing moved; the request can be repeated.
 * An answer still unknown is `ok` with the hold `unknown`: reconciliation settles it.
 */
export type HoldOutcome =
  | { readonly ok: true; readonly hold: HoldRecord }
  | {
      readonly ok: false;
      readonly reason: 'refused' | 'unavailable';
      readonly message: string;
      readonly hold?: HoldRecord;
    };

export const HOLD_MESSAGES = {
  unavailable: 'PayPal is not available right now. Nothing has been charged; try again shortly.',
  approveFirst: 'Approve the reservation in the PayPal window first. Nothing has been held.',
  refusedByPayPal: 'PayPal could not hold this payment. Nothing has been charged.',
  declined: 'PayPal declined this payment method. Nothing has been charged.',
  lapsed: 'This PayPal reservation expired before it was approved. Nothing has been charged.',
  notApplied: 'We could not keep this reservation, so the money held in PayPal was released.',
  releasing:
    'We could not keep this reservation. The money held in PayPal is being released; nothing will be charged.',
  closed: 'This reservation is closed. Nothing more will be charged.',
  notHeld: 'This reservation holds no money, so there is nothing to charge.',
  alreadyCaptured: 'This order has already been charged.',
  notCharged: 'PayPal did not take this charge. The money is still held; nothing more was charged.',
  settingUp: 'This reservation is still being set up with PayPal. Try again in a moment.',
} as const;

export const holdOk = (hold: HoldRecord): HoldOutcome => ({ ok: true, hold });

export const holdRefused = (message: string, hold?: HoldRecord): HoldOutcome => ({
  ok: false,
  reason: 'refused',
  message,
  ...(hold === undefined ? {} : { hold }),
});

export const holdUnavailable = (hold?: HoldRecord): HoldOutcome => ({
  ok: false,
  reason: 'unavailable',
  message: HOLD_MESSAGES.unavailable,
  ...(hold === undefined ? {} : { hold }),
});

/** The PayPal-Request-Id of one operation on one hold: the same on every retry. */
export const holdRequestId = (hold: HoldRecord, operation: string): string =>
  `${hold.id}:${operation}`;

/**
 * The `custom_id` of one refund of a hold: opaque (a SHA-256 of its request id, in hex, inside
 * PayPal's 127 characters and `[A-Za-z0-9-_.,]`), the same on every retry and different for
 * every operation, so a refund PayPal lists is matched to its own operation and to no other.
 */
export const holdRefundReference = (hold: HoldRecord, operation: string): string =>
  createHash('sha256')
    .update(holdRequestId(hold, `refund:${operation}`))
    .digest('hex');

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * Soon for an unknown answer; for an order waiting for its buyer, soon enough to authorize an
 * approval whose confirmation was lost while the offer still holds (minutes), then slowly.
 * Doubling each time.
 */
export function nextHoldCheck(status: HoldStatus, checks: number, now: Date): Date | null {
  const wait =
    status === 'unknown'
      ? { first: 30 * SECOND, ceiling: 30 * MINUTE }
      : status === 'created'
        ? { first: 2 * MINUTE, ceiling: 6 * 60 * MINUTE }
        : undefined;
  if (wait === undefined) return null;
  return new Date(now.getTime() + Math.min(wait.first * 2 ** checks, wait.ceiling));
}

export function changeHold(
  ctx: HoldContext,
  hold: HoldRecord,
  patch: HoldChange,
): Promise<HoldRecord> {
  return ctx.write((tx) => holdLedger.update(tx, hold, patch, ctx.source, ctx.clock.now()));
}

/** Keeps the hold as it is and looks again later, noting what went wrong. */
export function postponeHold(
  ctx: HoldContext,
  hold: HoldRecord,
  failure: PayPalError,
): Promise<HoldRecord> {
  ctx.logger.warn('hold left for reconciliation', {
    holdId: hold.id,
    operation: failure.operation,
    outcome: failure.outcome,
    issue: failure.issue,
    debugId: failure.debugId,
  });
  const checks = hold.checks + 1;
  return changeHold(ctx, hold, {
    detail: describeFailure(failure),
    checks,
    nextCheckAt: nextHoldCheck(hold.status, checks, ctx.clock.now()),
  });
}

/** Puts a hold back where it was before a call PayPal turned away without acting. */
export function restoreHold(
  ctx: HoldContext,
  hold: HoldRecord,
  status: 'created' | 'authorized',
  failure: PayPalError,
): Promise<HoldRecord> {
  return changeHold(ctx, hold, {
    status,
    pending: null,
    detail: describeFailure(failure),
    nextCheckAt: nextHoldCheck(status, 0, ctx.clock.now()),
  });
}

/** Each attempt starts from a fresher hold; requests racing on one hold settle within a few. */
const STALE_ATTEMPTS = 4;

/**
 * Runs a step that reads its hold itself. If another request moved the hold meanwhile, the step
 * is decided again from what the hold is now, so a repeated request gets an answer, not an error.
 */
export async function decideAgainWhenStale<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof StaleHoldError) || attempt === STALE_ATTEMPTS) throw error;
    }
  }
}
