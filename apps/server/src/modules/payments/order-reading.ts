import type { PayPalCapture, PayPalOrder, PayPalRefund } from './paypal/schemas.js';

/** What a PayPal order, as PayPal returns it, says has happened to the money. */
export type OrderReading =
  | {
      /** Charged (perhaps partly refunded since). */
      readonly kind: 'captured';
      readonly capture: PayPalCapture;
      readonly refunds: readonly PayPalRefund[];
    }
  | {
      readonly kind: 'refunded';
      readonly capture: PayPalCapture;
      readonly refunds: readonly PayPalRefund[];
    }
  /** PayPal is still reviewing the capture: the money is not confirmed yet. */
  | { readonly kind: 'capture-pending'; readonly capture: PayPalCapture }
  | { readonly kind: 'declined'; readonly capture: PayPalCapture }
  /** The buyer approved; nobody has captured it yet. */
  | { readonly kind: 'approved' }
  | { readonly kind: 'awaiting-buyer'; readonly paypalStatus: string | null }
  | { readonly kind: 'voided' }
  /** Nothing safe can be concluded from this answer. */
  | { readonly kind: 'unclear'; readonly detail: string };

/** Reads an order of intent CAPTURE: a single purchase unit with at most one capture. */
export function readOrder(order: PayPalOrder): OrderReading {
  const payments = order.purchase_units?.[0]?.payments;
  const capture = payments?.captures?.at(-1);
  const refunds = payments?.refunds ?? [];
  if (capture !== undefined) {
    switch (capture.status) {
      case 'COMPLETED':
      case 'PARTIALLY_REFUNDED':
        return { kind: 'captured', capture, refunds };
      case 'REFUNDED':
        return { kind: 'refunded', capture, refunds };
      case 'PENDING':
        return { kind: 'capture-pending', capture };
      case 'DECLINED':
      case 'FAILED':
        return { kind: 'declined', capture };
    }
  }
  switch (order.status) {
    case 'APPROVED':
      return { kind: 'approved' };
    case 'VOIDED':
      return { kind: 'voided' };
    case 'CREATED':
    case 'SAVED':
    case 'PAYER_ACTION_REQUIRED':
      return { kind: 'awaiting-buyer', paypalStatus: order.status };
    case 'COMPLETED':
      return { kind: 'unclear', detail: 'PayPal reports the order completed without a capture' };
    case undefined:
      return { kind: 'unclear', detail: 'PayPal did not report the status of the order' };
  }
}
