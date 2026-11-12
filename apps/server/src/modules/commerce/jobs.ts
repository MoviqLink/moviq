import type { Transaction } from '@libsql/client';

import { pause } from '../../infrastructure/clock/pause.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import { payoutLedger } from '../payments/payouts/payout-ledger.js';
import { refreshBatch } from '../payments/payouts/payout-run.js';
import type { CommerceDependencies } from './context.js';
import { merchantStore } from './merchants.js';
import { payoutContext, payWeek, startOfWeek } from './payouts.js';

/**
 * Worker job of the lease holder: once a week (the first round after Monday 00:00 in New
 * York), every merchant is paid what was collected before that week; every round, batches PayPal
 * has not settled are read back. A sale is never paid twice: the ledger refuses it.
 */
export async function settleMerchants(
  term: LeaderTerm,
  deps: CommerceDependencies & { readonly logger: Logger; readonly intervalMs: number },
): Promise<void> {
  const ctx = payoutContext(deps, deps.logger);
  if (ctx === undefined) {
    deps.logger.info('merchant payouts are off', { reason: 'PayPal is not set up' });
    return;
  }
  const fenced = { ...ctx, write: <T>(work: (tx: Transaction) => Promise<T>) => term.fenced(work) };
  let paidWeek: number | undefined;
  while (!term.signal.aborted) {
    try {
      const week = startOfWeek(deps.clock.now()).getTime();
      if (week !== paidWeek) {
        await payWeek(fenced, await merchantStore.all(deps.db));
        paidWeek = week;
      }
      for (const batch of await payoutLedger.due(deps.db, deps.clock.now(), 20))
        await refreshBatch(fenced, batch);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      deps.logger.error('merchant payouts round failed', { error });
    }
    await pause(deps.intervalMs, term.signal);
  }
}
