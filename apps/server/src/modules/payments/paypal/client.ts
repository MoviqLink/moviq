import { orderBody } from './order-body.js';
import type { PayPalGateway, WebhookHeaders } from './gateway.js';
import {
  authorizationSchema,
  captureSchema,
  orderSchema,
  refundSchema,
  toPayPalAmount,
  verificationSchema,
} from './schemas.js';
import { parse, parsed, requester, type PayPalClientOptions, type Requester } from './transport.js';

export type { PayPalClientOptions } from './transport.js';

/** PayPal's REST API over the shared HTTP client, with the OAuth2 token cached until it expires. */
export function createPayPalClient(options: PayPalClientOptions): PayPalGateway {
  const request = requester(options);
  return { ...ordersApi(request), ...paymentsApi(request), ...webhooksApi(request) };
}

const id = encodeURIComponent;

function ordersApi(
  request: Requester,
): Pick<PayPalGateway, 'createOrder' | 'getOrder' | 'captureOrder' | 'authorizeOrder'> {
  return {
    createOrder: (input) =>
      parsed(request, orderSchema, {
        operation: 'orders.create',
        method: 'POST',
        path: '/v2/checkout/orders',
        requestId: input.requestId,
        body: orderBody(input),
      }),
    getOrder: (orderId) =>
      parsed(request, orderSchema, {
        operation: 'orders.get',
        method: 'GET',
        path: `/v2/checkout/orders/${id(orderId)}`,
      }),
    captureOrder: (orderId, requestId) =>
      parsed(request, orderSchema, {
        operation: 'orders.capture',
        method: 'POST',
        path: `/v2/checkout/orders/${id(orderId)}/capture`,
        requestId,
        body: '{}',
      }),
    authorizeOrder: (orderId, requestId) =>
      parsed(request, orderSchema, {
        operation: 'orders.authorize',
        method: 'POST',
        path: `/v2/checkout/orders/${id(orderId)}/authorize`,
        requestId,
        body: '{}',
      }),
  };
}

function paymentsApi(
  request: Requester,
): Pick<
  PayPalGateway,
  'captureAuthorization' | 'voidAuthorization' | 'refundCapture' | 'getRefund'
> {
  return {
    captureAuthorization: (authorizationId, input) =>
      parsed(request, captureSchema, {
        operation: 'authorizations.capture',
        method: 'POST',
        path: `/v2/payments/authorizations/${id(authorizationId)}/capture`,
        requestId: input.requestId,
        body: JSON.stringify({
          ...(input.amount === undefined ? {} : { amount: toPayPalAmount(input.amount) }),
          final_capture: input.finalCapture,
        }),
      }),
    voidAuthorization: async (authorizationId, requestId) => {
      const body = await request({
        operation: 'authorizations.void',
        method: 'POST',
        path: `/v2/payments/authorizations/${id(authorizationId)}/void`,
        requestId,
      });
      return body === undefined
        ? undefined
        : parse(authorizationSchema, 'authorizations.void', body);
    },
    refundCapture: (captureId, input) =>
      parsed(request, refundSchema, {
        operation: 'captures.refund',
        method: 'POST',
        path: `/v2/payments/captures/${id(captureId)}/refund`,
        requestId: input.requestId,
        body: JSON.stringify({
          ...(input.amount === undefined ? {} : { amount: toPayPalAmount(input.amount) }),
          ...(input.customId === undefined ? {} : { custom_id: input.customId }),
        }),
      }),
    getRefund: (refundId) =>
      parsed(request, refundSchema, {
        operation: 'refunds.get',
        method: 'GET',
        path: `/v2/payments/refunds/${id(refundId)}`,
      }),
  };
}

function webhooksApi(request: Requester): Pick<PayPalGateway, 'verifyWebhookSignature'> {
  return {
    verifyWebhookSignature: async ({ headers, rawEvent, webhookId }) => {
      const result = await parsed(request, verificationSchema, {
        operation: 'webhooks.verify',
        method: 'POST',
        path: '/v1/notifications/verify-webhook-signature',
        body: verificationBody(headers, rawEvent, webhookId),
      });
      return result.verification_status === 'SUCCESS';
    },
  };
}

/**
 * The event goes back byte for byte as it arrived: parsing and serialising it again can change
 * it and make PayPal's check fail. It must be JSON, so it cannot add fields of its own.
 */
function verificationBody(headers: WebhookHeaders, rawEvent: string, webhookId: string): string {
  JSON.parse(rawEvent);
  const head = JSON.stringify({
    auth_algo: headers.authAlgo,
    cert_url: headers.certUrl,
    transmission_id: headers.transmissionId,
    transmission_sig: headers.transmissionSig,
    transmission_time: headers.transmissionTime,
    webhook_id: webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${rawEvent}}`;
}
