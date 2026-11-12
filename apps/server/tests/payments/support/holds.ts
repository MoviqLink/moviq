import type { HoldPurpose } from '@moviq/contracts';

import type { Database } from '../../../src/infrastructure/database/database.js';
import type {
  HoldContext,
  HoldPurchases,
} from '../../../src/modules/payments/holds/hold-context.js';
import type { HoldRecord } from '../../../src/modules/payments/holds/hold-ledger.js';
import { authorizeHold, startHold } from '../../../src/modules/payments/holds/hold-steps.js';
import { manualClock, type ManualClock } from '../../support/manual-clock.js';
import { memoryLogger } from '../../support/memory-logger.js';
import type { TempDatabase } from '../../support/temp-database.js';
import { fakeHoldPayPal, type FakeHoldPayPal } from './fake-paypal-holds.js';
import { addTraveller, paymentsDatabase } from './payments.js';

export const purpose: HoldPurpose = { kind: 'merchant-offer', offerId: 'offer-1' };

export const presentation = {
  brandName: 'MovIQ',
  locale: 'es-US' as const,
  items: [
    {
      name: 'Vegan miso ramen (no scallions)',
      quantity: 1,
      unitAmount: { amountMinor: 1695, currency: 'USD' as const },
      category: 'PHYSICAL_GOODS' as const,
    },
  ],
  discount: { amountMinor: 255, currency: 'USD' as const },
};

/** What the test purchase applied, by hold; `refuse` makes the authorization refuse it. */
export interface Applied {
  readonly authorized: string[];
  readonly captured: string[];
  readonly voided: string[];
  refuse: boolean;
}

export interface HoldWorld {
  readonly clock: ManualClock;
  readonly temp: TempDatabase;
  readonly db: Database;
  readonly paypal: FakeHoldPayPal;
  readonly applied: Applied;
  readonly ctx: HoldContext;
  readonly travellerId: string;
  /** A hold opened for 14.40 USD, not yet approved by the buyer. */
  readonly started: () => Promise<HoldRecord>;
  /** A hold approved by the buyer and authorized by PayPal. */
  readonly held: () => Promise<HoldRecord>;
}

/** A migrated database, PayPal in memory and a purchase that records what it applies. */
export async function holdWorld(): Promise<HoldWorld> {
  const clock = manualClock();
  const { temp, db } = await paymentsDatabase(clock);
  const paypal = fakeHoldPayPal();
  const applied: Applied = { authorized: [], captured: [], voided: [], refuse: false };
  const purchases: HoldPurchases = {
    authorized: (_p, id: string) => {
      if (applied.refuse) return Promise.reject(new Error('The kitchen filled up.'));
      applied.authorized.push(id);
      return Promise.resolve();
    },
    captured: (_p, id) => Promise.resolve(void applied.captured.push(id)),
    voided: (_p, id) => Promise.resolve(void applied.voided.push(id)),
  };
  const ctx: HoldContext = {
    db,
    clock,
    logger: memoryLogger().logger,
    paypal,
    purchases,
    source: 'api',
    write: (work) => db.transaction(work),
  };
  const travellerId = await addTraveller(db, clock);
  const started = async () => {
    const outcome = await startHold(ctx, {
      travellerId,
      purpose,
      amount: { amountMinor: 1440, currency: 'USD' },
      description: 'Tsuki Ramen House (demo)',
      presentation,
    });
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.hold;
  };
  const held = async () => {
    const hold = await started();
    paypal.approve(hold.paypalOrderId ?? '');
    const authorized = await authorizeHold(ctx, hold);
    if (!authorized.ok) throw new Error(authorized.message);
    return authorized.hold;
  };
  return { clock, temp, db, paypal, applied, ctx, travellerId, started, held };
}
