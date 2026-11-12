import type { Money } from '@moviq/contracts';

import type { PayPalAuthorization, PayPalCapture, PayPalOrder, PayPalRefund } from './schemas.js';

export type PayPalEnvironment = 'sandbox' | 'live';

/** The headers PayPal signs a webhook delivery with. */
export interface WebhookHeaders {
  readonly authAlgo: string;
  readonly certUrl: string;
  readonly transmissionId: string;
  readonly transmissionSig: string;
  readonly transmissionTime: string;
}

/**
 * What the PayPal window shows besides the amount: the brand, its language and the lines of the
 * purchase. The items less the discount must add up to the amount.
 */
export interface OrderPresentation {
  readonly brandName: string;
  /** A PayPal locale, such as `en-US` or `es-US`. */
  readonly locale: 'en-US' | 'es-US';
  readonly items: readonly {
    readonly name: string;
    readonly quantity: number;
    readonly unitAmount: Money;
    readonly category: 'PHYSICAL_GOODS' | 'DIGITAL_GOODS';
  }[];
  readonly discount: Money;
}

export interface CreateOrderInput {
  readonly intent: 'CAPTURE' | 'AUTHORIZE';
  readonly amount: Money;
  readonly presentation?: OrderPresentation;
  /** Shown to the buyer in PayPal: it must carry no personal data and no internal ids. */
  readonly description: string;
  /** An opaque reference of the operation, never a journey, a traveller or a merchant id. */
  readonly referenceId: string;
  readonly requestId: string;
  /**
   * A billing agreement the buyer approved before: the order is charged to it with no PayPal
   * window. Without it, the buyer approves the order in the window.
   */
  readonly billingAgreementId?: string;
}

/**
 * PayPal Orders v2, Payments v2 and webhook verification. Every call that moves money takes a
 * `requestId`, sent as `PayPal-Request-Id`: repeating a call with the same one returns PayPal's
 * first result instead of acting twice. Failures are `PayPalError`s.
 */
export interface PayPalGateway {
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  authorizeOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  /** All of an authorization, or `amount` of it; `finalCapture` releases whatever is left. */
  captureAuthorization(
    authorizationId: string,
    input: { readonly amount?: Money; readonly finalCapture: boolean; readonly requestId: string },
  ): Promise<PayPalCapture>;
  /** PayPal answers 204, or the voided authorization. */
  voidAuthorization(
    authorizationId: string,
    requestId: string,
  ): Promise<PayPalAuthorization | undefined>;
  /**
   * The whole capture, or `amount` of it. `customId`, an opaque reference of the operation, is
   * returned on the refund and in the order, so a refund whose answer was lost is found by it.
   */
  refundCapture(
    captureId: string,
    input: { readonly amount?: Money; readonly customId?: string; readonly requestId: string },
  ): Promise<PayPalRefund>;
  /** A refund as PayPal has it now, to follow one that was still pending. */
  getRefund(refundId: string): Promise<PayPalRefund>;
  /** Asks PayPal whether a delivery really comes from PayPal. */
  verifyWebhookSignature(input: {
    readonly headers: WebhookHeaders;
    readonly rawEvent: string;
    readonly webhookId: string;
  }): Promise<boolean>;
}
