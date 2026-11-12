import type { Alternative, PaymentPurpose } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { PurchaseCatalog, PurchaseQuote } from '../payments/catalog.js';
import { journeyStore } from './journey-store.js';
import { switchToAlternative } from './switch-alternative.js';

type PricedAlternative = Alternative & { readonly price: NonNullable<Alternative['price']> };

/**
 * What journeys sell: a paid alternative (the demo taxi partner). The price is the one the
 * server put on the alternative; the switch happens only after PayPal confirms the money.
 */
export function journeyPurchases(deps: {
  readonly db: Database;
  readonly clock: Clock;
}): PurchaseCatalog {
  return {
    async quote(purpose, travellerId): Promise<PurchaseQuote> {
      if (purpose.kind !== 'journey-alternative')
        return { ok: false, reason: 'Not a journey alternative.' };
      const found = await paidAlternative(deps.db, purpose, travellerId);
      if (typeof found === 'string') return { ok: false, reason: found };
      return { ok: true, amount: found.price, description: found.why };
    },
    /**
     * Runs in the transaction that records the capture: the journey is read again there, so a
     * cancellation that won the race refuses it and Payments refunds the money.
     */
    async fulfil(purpose, paymentId, tx) {
      if (purpose.kind !== 'journey-alternative') throw new Error('Not a journey alternative.');
      const stored = await journeyStore.getInTransaction(tx, purpose.journeyId);
      if (stored !== undefined && stored.journey.state !== 'watching')
        throw new Error('This journey is no longer being watched.');
      const alternative = stored?.journey.alternatives.find(
        (candidate) => candidate.id === purpose.alternativeId,
      );
      if (stored === undefined || alternative === undefined)
        throw new Error('The paid alternative no longer exists.');
      const switched = await switchToAlternative(
        tx,
        stored,
        alternative,
        {
          event: 'alternative-paid',
          detail: { paymentId },
          evidence: 'Switched to the alternative you paid for.',
        },
        deps.clock.now(),
      );
      if (!switched) throw new Error('The journey changed while the payment was confirmed.');
    },
  };
}

async function paidAlternative(
  db: Database,
  purpose: Extract<PaymentPurpose, { kind: 'journey-alternative' }>,
  travellerId: string,
): Promise<PricedAlternative | string> {
  const stored = await journeyStore.get(db, purpose.journeyId);
  if (stored?.travellerId !== travellerId) return 'There is no journey with that id.';
  if (stored.journey.state !== 'watching') return 'This journey is no longer being watched.';
  const alternative = stored.journey.alternatives.find(
    (candidate) => candidate.id === purpose.alternativeId,
  );
  if (alternative === undefined) return 'That alternative is no longer on offer.';
  const { price } = alternative;
  if (price === null) return 'That alternative costs nothing: just take it.';
  return { ...alternative, price };
}
