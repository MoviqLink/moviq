export type HoldStatus = 'unknown' | 'created' | 'authorized' | 'captured' | 'voided' | 'failed';

/** What an `unknown` hold waits for PayPal to settle. */
export type HoldPending = 'create' | 'authorize' | 'capture' | 'void';

/**
 * Every status change a hold can make. The same list is in the database
 * (`payment_hold_transitions`), whose trigger refuses any other; a test keeps both equal.
 */
export const HOLD_TRANSITIONS: Readonly<Record<HoldStatus, readonly HoldStatus[]>> = {
  /** PayPal has not answered yet: whatever it says next decides. */
  unknown: ['created', 'authorized', 'captured', 'voided', 'failed'],
  /** The order waits for its buyer, or for the authorization MovIQ is about to ask for. */
  created: ['unknown', 'failed', 'voided'],
  /** The money is held: it is captured at pickup or voided on cancellation. */
  authorized: ['unknown'],
  /** Charged. Refunds of missing lines are recorded apart and never change it. */
  captured: [],
  voided: [],
  failed: [],
};

export function canMoveHold(from: HoldStatus, to: HoldStatus): boolean {
  return from === to || HOLD_TRANSITIONS[from].includes(to);
}
