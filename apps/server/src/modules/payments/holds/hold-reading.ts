import type { PayPalAuthorization, PayPalCapture, PayPalOrder } from '../paypal/schemas.js';

/** What an order of intent AUTHORIZE, as PayPal returns it, says has happened to the money. */
export type HoldReading =
  | { readonly kind: 'authorized'; readonly authorization: PayPalAuthorization }
  | { readonly kind: 'captured'; readonly capture: PayPalCapture }
  /** PayPal is still reviewing the authorization or the capture. */
  | { readonly kind: 'pending'; readonly paypalStatus: string }
  | { readonly kind: 'voided'; readonly paypalStatus: string }
  | { readonly kind: 'denied'; readonly paypalStatus: string }
  /** The buyer approved the order; nobody has authorized it yet. */
  | { readonly kind: 'approved' }
  | { readonly kind: 'awaiting-buyer'; readonly paypalStatus: string | null }
  | { readonly kind: 'unclear'; readonly detail: string };

/** Reads an order of intent AUTHORIZE: one purchase unit, one authorization, one capture. */
export function readHoldOrder(order: PayPalOrder): HoldReading {
  const payments = order.purchase_units?.[0]?.payments;
  const capture = payments?.captures?.at(-1);
  if (capture !== undefined) return readCapture(capture);
  const authorization = payments?.authorizations?.at(-1);
  if (authorization !== undefined) return readAuthorization(authorization);
  switch (order.status) {
    case 'APPROVED':
      return { kind: 'approved' };
    case 'VOIDED':
      return { kind: 'voided', paypalStatus: 'VOIDED' };
    case 'CREATED':
    case 'SAVED':
    case 'PAYER_ACTION_REQUIRED':
      return { kind: 'awaiting-buyer', paypalStatus: order.status };
    case 'COMPLETED':
      return { kind: 'unclear', detail: 'PayPal reports the order completed without a payment' };
    case undefined:
      return { kind: 'unclear', detail: 'PayPal did not report the status of the order' };
  }
}

export function readCapture(capture: PayPalCapture): HoldReading {
  switch (capture.status) {
    case 'COMPLETED':
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return { kind: 'captured', capture };
    case 'PENDING':
      return { kind: 'pending', paypalStatus: 'CAPTURE_PENDING' };
    case 'DECLINED':
    case 'FAILED':
      return { kind: 'denied', paypalStatus: `CAPTURE_${capture.status}` };
  }
}

export function readAuthorization(authorization: PayPalAuthorization): HoldReading {
  switch (authorization.status) {
    case 'CREATED':
      return { kind: 'authorized', authorization };
    case 'PENDING':
      return { kind: 'pending', paypalStatus: 'AUTHORIZATION_PENDING' };
    case 'VOIDED':
      return { kind: 'voided', paypalStatus: 'VOIDED' };
    case 'DENIED':
      return { kind: 'denied', paypalStatus: 'DENIED' };
    case 'CAPTURED':
    case 'PARTIALLY_CAPTURED':
      return { kind: 'unclear', detail: 'PayPal reports a capture it did not list' };
  }
}
