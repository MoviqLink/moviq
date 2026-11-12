import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { PurchaseCatalog } from './catalog.js';
import { change, nextCheck, type PaymentContext } from './context.js';
import { paymentLedger, StalePaymentError, type PaymentRecord } from './ledger.js';
import { settle } from './settlement.js';
import type { PaymentsSetup } from './setup.js';
import { openOrder } from './steps.js';

export interface ReconcileDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly catalog: PurchaseCatalog;
  readonly setup: PaymentsSetup;
  /** Pause between rounds. */
  readonly intervalMs: number;
  /** Payments looked at per round, oldest due first. */
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 20;

/**
 * Worker job of the lease holder: every round, the payments PayPal has not settled (an unknown
 * answer, an order waiting for its buyer, a capture or a refund in doubt) are read back from
 * PayPal and brought up to date. Writes are fenced: a worker that lost the lease writes nothing.
 * One payment failing never holds up the others.
 */
export async function reconcilePayments(
  term: LeaderTerm,
  deps: ReconcileDependencies,
): Promise<void> {
  if (!deps.setup.available) {
    deps.logger.info('payment reconciliation is off', { reason: deps.setup.reason });
    return;
  }
  const ctx: PaymentContext = {
    db: deps.db,
    clock: deps.clock,
    logger: deps.logger,
    paypal: deps.setup.paypal,
    catalog: deps.catalog,
    source: 'reconciliation',
    write: (work) => term.fenced(work),
  };
  while (!term.signal.aborted) {
    await reconcileRound(ctx, term, deps.batchSize ?? DEFAULT_BATCH);
    await pause(deps.intervalMs, term.signal);
  }
}

async function reconcileRound(
  ctx: PaymentContext,
  term: LeaderTerm,
  batchSize: number,
): Promise<void> {
  let due: readonly PaymentRecord[];
  try {
    due = await paymentLedger.due(ctx.db, ctx.clock.now(), batchSize);
  } catch (error) {
    ctx.logger.warn('payments due could not be read', { error });
    return;
  }
  for (const payment of due) {
    if (term.signal.aborted) return;
    await reconcileOne(ctx, payment);
  }
}

async function reconcileOne(ctx: PaymentContext, payment: PaymentRecord): Promise<void> {
  try {
    const outcome =
      payment.pending === 'create' ? await openOrder(ctx, payment) : await settle(ctx, payment);
    ctx.logger.debug('payment reconciled', {
      paymentId: payment.id,
      status: outcome.payment?.status ?? payment.status,
    });
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    // Someone else moved it meanwhile; the next round sees it as it is now.
    if (error instanceof StalePaymentError) return;
    ctx.logger.error('payment reconciliation failed', { paymentId: payment.id, error });
    await deferAfterError(ctx, payment);
  }
}

async function deferAfterError(ctx: PaymentContext, payment: PaymentRecord): Promise<void> {
  const checks = payment.checks + 1;
  try {
    await change(ctx, payment, {
      checks,
      nextCheckAt: nextCheck(payment.status, checks, ctx.clock.now()),
    });
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    ctx.logger.warn('payment could not be rescheduled', { paymentId: payment.id, error });
  }
}
