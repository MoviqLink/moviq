import type { Transaction } from '@libsql/client';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { PurchaseCatalog } from './catalog.js';
import {
  paymentLedger,
  type PaymentChange,
  type PaymentRecord,
  type PaymentSource,
} from './ledger.js';
import type { PayPalError } from './paypal/errors.js';
import type { PayPalGateway } from './paypal/gateway.js';
import type { PaymentStatus } from './transitions.js';

/** What every payment step needs. `write` is the database's transaction, or a fenced one. */
export interface PaymentContext {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly paypal: PayPalGateway;
  readonly catalog: PurchaseCatalog;
  readonly source: PaymentSource;
  readonly write: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>;
}

/**
 * The result of a step, for whoever asked. `refused`: the payment will not go ahead as asked
 * (the message says why, for the traveller). `unavailable`: PayPal could not be reached and
 * nothing moved; the same request can be repeated.
 */
export type Outcome =
  | { readonly ok: true; readonly payment: PaymentRecord }
  | {
      readonly ok: false;
      readonly reason: 'refused' | 'unavailable';
      readonly message: string;
      readonly payment?: PaymentRecord;
    };

export const MESSAGES = {
  unavailable:
    'PayPal is not available right now. Nothing has been charged; please try again in a moment.',
  approveFirst: 'Approve the payment in the PayPal window first. Nothing has been charged.',
  instrumentDeclined:
    'PayPal declined that payment method. Choose another one in PayPal; nothing has been charged.',
  refusedByPayPal: 'PayPal could not take this payment. Nothing has been charged.',
  declined: 'PayPal declined this payment. Nothing has been charged.',
  lapsed: 'This PayPal payment expired before it was approved. Nothing has been charged.',
  voided: 'This payment was cancelled in PayPal. Nothing has been charged.',
  failed: 'This payment did not go through. Nothing has been charged.',
  priceChanged: 'The price changed before the payment was confirmed. Nothing has been charged.',
  refunding: 'We could not apply this purchase after the payment, so we are refunding it in full.',
  refunded: 'This payment was refunded in full.',
  alreadyPaid: 'This has already been paid.',
  settingUp: 'This payment is still being set up with PayPal. Try again in a moment.',
  confirming: 'A payment for this is still being confirmed with PayPal. Check it in a moment.',
} as const;

export const ok = (payment: PaymentRecord): Outcome => ({ ok: true, payment });

export const refused = (message: string, payment?: PaymentRecord): Outcome => ({
  ok: false,
  reason: 'refused',
  message,
  ...(payment === undefined ? {} : { payment }),
});

export const unavailable = (payment?: PaymentRecord): Outcome => ({
  ok: false,
  reason: 'unavailable',
  message: MESSAGES.unavailable,
  ...(payment === undefined ? {} : { payment }),
});

/** The PayPal-Request-Id of one operation on one payment: the same on every retry. */
export const requestId = (payment: PaymentRecord, operation: string): string =>
  `${payment.id}:${operation}`;

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/**
 * When reconciliation looks again: soon for an unknown answer, slowly for an order waiting for
 * its buyer; each fruitless look doubles the wait, up to a ceiling. Settled payments are not
 * looked at again.
 */
export function nextCheck(status: PaymentStatus, checks: number, now: Date): Date | null {
  const wait =
    status === 'unknown'
      ? { first: 30 * SECOND, ceiling: 30 * MINUTE }
      : status === 'created' || status === 'approved'
        ? { first: 15 * MINUTE, ceiling: 6 * 60 * MINUTE }
        : undefined;
  if (wait === undefined) return null;
  return new Date(now.getTime() + Math.min(wait.first * 2 ** checks, wait.ceiling));
}

/** Applies one change in its own transaction. */
export function change(
  ctx: PaymentContext,
  payment: PaymentRecord,
  patch: PaymentChange,
): Promise<PaymentRecord> {
  return ctx.write((tx) => paymentLedger.update(tx, payment, patch, ctx.source, ctx.clock.now()));
}

/** Keeps the payment as it is and looks again later, noting what went wrong. */
export function postpone(
  ctx: PaymentContext,
  payment: PaymentRecord,
  failure: PayPalError,
): Promise<PaymentRecord> {
  ctx.logger.warn('payment left for reconciliation', {
    paymentId: payment.id,
    operation: failure.operation,
    outcome: failure.outcome,
    issue: failure.issue,
    debugId: failure.debugId,
  });
  const checks = payment.checks + 1;
  return change(ctx, payment, {
    detail: describeFailure(failure),
    checks,
    nextCheckAt: nextCheck(payment.status, checks, ctx.clock.now()),
  });
}

/** A line for the ledger and the control room: what PayPal said, never the traveller's data. */
export function describeFailure(failure: PayPalError): string {
  const parts = [`${failure.operation}: ${failure.outcome}`];
  if (failure.status !== undefined) parts.push(`HTTP ${String(failure.status)}`);
  if (failure.issue !== undefined) parts.push(failure.issue);
  if (failure.debugId !== undefined) parts.push(`debug id ${failure.debugId}`);
  return parts.join(', ');
}
