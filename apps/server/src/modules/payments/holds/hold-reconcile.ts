import type { Clock } from '../../../infrastructure/clock/clock.js';
import { pause } from '../../../infrastructure/clock/pause.js';
import type { Database } from '../../../infrastructure/database/database.js';
import { LeaseLostError, type LeaderTerm } from '../../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../../infrastructure/telemetry/logger.js';
import type { PaymentsSetup } from '../setup.js';
import { changeHold, nextHoldCheck, type HoldContext, type HoldPurchases } from './hold-context.js';
import { holdLedger, StaleHoldError, type HoldRecord } from './hold-ledger.js';
import { checkRefund } from './hold-refund-checks.js';
import { refundStore } from './hold-refund-store.js';
import { releaseStore } from './hold-release-store.js';
import { release } from './hold-releases.js';
import { settleHold } from './hold-settle.js';
import { authorizeHold, openHoldOrder } from './hold-steps.js';

export interface HoldReconcileDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly purchases: HoldPurchases;
  readonly setup: PaymentsSetup;
  readonly intervalMs: number;
  readonly batchSize?: number;
}

const DEFAULT_BATCH = 20;

/**
 * Worker job of the lease holder: holds PayPal has not settled (an unknown answer, an order
 * waiting for its buyer) are read back and brought up to date. An order the buyer approved but
 * whose confirmation never arrived is authorized, as they asked. Then the money MovIQ owes back
 * is followed apart from the holds: releases owed for refused purchases and refunds PayPal has
 * not confirmed. Writes are fenced.
 */
export async function reconcileHolds(
  term: LeaderTerm,
  deps: HoldReconcileDependencies,
): Promise<void> {
  if (!deps.setup.available) {
    deps.logger.info('hold reconciliation is off', { reason: deps.setup.reason });
    return;
  }
  const ctx: HoldContext = {
    db: deps.db,
    clock: deps.clock,
    logger: deps.logger,
    paypal: deps.setup.paypal,
    purchases: deps.purchases,
    source: 'reconciliation',
    write: (work) => term.fenced(work),
  };
  while (!term.signal.aborted) {
    await reconcileRound(ctx, term, deps.batchSize ?? DEFAULT_BATCH);
    await pause(deps.intervalMs, term.signal);
  }
}

/** One round over what is due, oldest first; one failing never holds up the others. */
export async function reconcileRound(
  ctx: HoldContext,
  term: Pick<LeaderTerm, 'signal'>,
  batchSize: number,
): Promise<void> {
  const now = ctx.clock.now();
  await each(
    ctx,
    term,
    () => holdLedger.due(ctx.db, now, batchSize),
    (hold) => reconcileOne(ctx, hold),
  );
  await each(
    ctx,
    term,
    () => releaseStore.due(ctx.db, now, batchSize),
    (owed) => guarded(ctx, owed.holdId, () => release(ctx, owed)),
  );
  await each(
    ctx,
    term,
    () => refundStore.due(ctx.db, now, batchSize),
    (refund) => guarded(ctx, refund.holdId, () => checkRefund(ctx, refund)),
  );
}

async function each<T>(
  ctx: HoldContext,
  term: Pick<LeaderTerm, 'signal'>,
  read: () => Promise<readonly T[]>,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let due: readonly T[];
  try {
    due = await read();
  } catch (error) {
    ctx.logger.warn('reconciliation could not read what is due', { error });
    return;
  }
  for (const item of due) {
    if (term.signal.aborted) return;
    await work(item);
  }
}

/** A release or a refund that fails is looked at again in a later round. */
async function guarded(ctx: HoldContext, holdId: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    if (error instanceof StaleHoldError) return;
    ctx.logger.error('reconciling money owed back failed', { holdId, error });
  }
}

async function reconcileOne(ctx: HoldContext, hold: HoldRecord): Promise<void> {
  try {
    if (hold.pending === 'create') {
      await openHoldOrder(ctx, hold);
      return;
    }
    const current = (await settleHold(ctx, hold)).hold;
    if (current?.status === 'created' && current.paypalStatus === 'APPROVED') {
      await authorizeHold(ctx, current);
    }
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    if (error instanceof StaleHoldError) return;
    ctx.logger.error('hold reconciliation failed', { holdId: hold.id, error });
    await deferAfterError(ctx, hold);
  }
}

async function deferAfterError(ctx: HoldContext, hold: HoldRecord): Promise<void> {
  const checks = hold.checks + 1;
  try {
    await changeHold(ctx, hold, {
      checks,
      nextCheckAt: nextHoldCheck(hold.status, checks, ctx.clock.now()),
    });
  } catch (error) {
    if (error instanceof LeaseLostError) throw error;
    ctx.logger.warn('hold could not be rescheduled', { holdId: hold.id, error });
  }
}
