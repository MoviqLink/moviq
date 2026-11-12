import type { Transaction } from '@libsql/client';
import type { Alternative } from '@moviq/contracts';

import { journeyStore, type StoredJourney } from './journey-store.js';

export interface SwitchRecord {
  /** The journey event, such as `alternative-chosen` or `alternative-paid`. */
  readonly event: string;
  readonly detail: Readonly<Record<string, string>>;
  /** What the journey says until the worker checks the new itinerary. */
  readonly evidence: string;
}

/**
 * Puts a journey on one of its alternatives inside the caller's transaction: the new itinerary,
 * no more alternatives, a watch that starts again, and the event that says why. False when the
 * journey changed meanwhile, so nothing is written over a newer version.
 */
export async function switchToAlternative(
  tx: Transaction,
  stored: StoredJourney,
  alternative: Alternative,
  record: SwitchRecord,
  now: Date,
): Promise<boolean> {
  const updated = await journeyStore.update(
    tx,
    stored.journey.id,
    stored.version,
    {
      itinerary: alternative.itinerary,
      alternatives: [],
      watch: {
        status: 'unknown',
        evaluatedAt: null,
        projectedArriveAt: null,
        evidence: record.evidence,
        flight: stored.journey.watch.flight,
        stepFreeRefusal: null,
      },
    },
    now,
  );
  if (updated)
    await journeyStore.addEvent(
      tx,
      stored.journey.id,
      record.event,
      { alternativeId: alternative.id, ...record.detail },
      now,
    );
  return updated;
}
