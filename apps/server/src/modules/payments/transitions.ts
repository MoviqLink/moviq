import type { paymentStatusSchema } from '@moviq/contracts';
import type { z } from 'zod';

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * Every status change a payment can make, and why. The same list is in the database
 * (`payment_status_transitions`), whose trigger refuses any other change; a test keeps both equal.
 */
export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  /** PayPal has not answered yet: whatever it says next decides. */
  unknown: ['created', 'approved', 'captured', 'refunded', 'failed', 'voided'],
  /** The order exists and waits for the buyer, or for the capture MovIQ is about to send. */
  created: ['approved', 'unknown', 'failed', 'voided'],
  /** The buyer approved it in PayPal; capturing it is the next step. */
  approved: ['unknown', 'failed', 'voided'],
  /** Charged and applied. Only a refund reported by PayPal changes it. */
  captured: ['refunded'],
  authorized: [],
  voided: [],
  refunded: [],
  failed: [],
};

export function canMove(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}
