import { z } from 'zod';

import type { PaymentContext } from './context.js';
import { providerEvents } from './events.js';
import { paymentLedger } from './ledger.js';
import { toPayPalError } from './paypal/errors.js';
import type { WebhookHeaders } from './paypal/gateway.js';
import { settle } from './settlement.js';

/** The envelope of a PayPal notification. Its content is never trusted: the order is read back. */
const eventSchema = z.object({
  id: z.string().min(1).max(100),
  event_type: z.string().min(1).max(100),
  resource_type: z.string().optional(),
  resource: z
    .object({
      id: z.string().optional(),
      supplementary_data: z
        .object({ related_ids: z.object({ order_id: z.string().optional() }).optional() })
        .optional(),
      links: z.array(z.object({ href: z.string(), rel: z.string() })).optional(),
    })
    .optional(),
});

type PayPalEvent = z.infer<typeof eventSchema>;

export type WebhookResult =
  | { readonly kind: 'processed' | 'duplicate' | 'unmatched' }
  /** Not a genuine, well-formed PayPal notification: refused, and PayPal need not send it again. */
  | { readonly kind: 'rejected'; readonly message: string }
  /** It could not be handled now: PayPal sends it again later. */
  | { readonly kind: 'retry'; readonly message: string };

const headerValue = (max: number) => z.string().min(1).max(max);

/** PayPal's signature headers, with the limits of its verification API. */
const headersSchema = z.object({
  authAlgo: headerValue(100),
  certUrl: headerValue(500),
  transmissionId: headerValue(50),
  transmissionSig: headerValue(500),
  transmissionTime: headerValue(100),
});

/** Reads PayPal's signature headers; undefined if any is missing or malformed. */
export function signatureHeaders(
  header: (name: string) => string | undefined,
): WebhookHeaders | undefined {
  const parsed = headersSchema.safeParse({
    authAlgo: header('paypal-auth-algo'),
    certUrl: header('paypal-cert-url'),
    transmissionId: header('paypal-transmission-id'),
    transmissionSig: header('paypal-transmission-sig'),
    transmissionTime: header('paypal-transmission-time'),
  });
  return parsed.success ? parsed.data : undefined;
}

/**
 * Handles one delivery: the signature is checked with PayPal, an event already processed is
 * acknowledged without running again, and an event is marked processed only once its payment
 * is up to date. A failure leaves it unprocessed, so PayPal's next delivery runs it again.
 */
export async function handleWebhook(
  ctx: PaymentContext,
  delivery: {
    readonly webhookId: string;
    readonly headers: WebhookHeaders | undefined;
    readonly rawBody: string;
  },
): Promise<WebhookResult> {
  if (delivery.headers === undefined) {
    return { kind: 'rejected', message: 'This notification is not signed by PayPal.' };
  }
  const event = parseEvent(delivery.rawBody);
  if (event === undefined) {
    return { kind: 'rejected', message: 'This notification is not a PayPal event.' };
  }
  let verified: boolean;
  try {
    verified = await ctx.paypal.verifyWebhookSignature({
      headers: delivery.headers,
      rawEvent: delivery.rawBody,
      webhookId: delivery.webhookId,
    });
  } catch (error) {
    const failure = toPayPalError('webhooks.verify', error);
    ctx.logger.warn('webhook signature could not be checked', { outcome: failure.outcome });
    return { kind: 'retry', message: 'The notification could not be checked with PayPal yet.' };
  }
  if (!verified) {
    ctx.logger.warn('webhook signature refused by PayPal', { eventType: event.event_type });
    return {
      kind: 'rejected',
      message: 'PayPal did not confirm the signature of this notification.',
    };
  }
  const { processed } = await providerEvents.receive(
    ctx.db,
    { id: event.id, type: event.event_type },
    ctx.clock.now(),
  );
  if (processed) return { kind: 'duplicate' };
  try {
    return await processEvent(ctx, event);
  } catch (error) {
    ctx.logger.error('webhook processing failed', { eventType: event.event_type, error });
    await providerEvents.markFailed(ctx.db, event.id, error instanceof Error ? error.message : '');
    return { kind: 'retry', message: 'The notification could not be processed yet.' };
  }
}

async function processEvent(ctx: PaymentContext, event: PayPalEvent): Promise<WebhookResult> {
  const ids = paypalIds(event);
  const payment =
    ids.orderId === undefined && ids.captureId === undefined
      ? undefined
      : await paymentLedger.findByPayPal(ctx.db, ids);
  if (payment === undefined) {
    await ctx.write((tx) =>
      providerEvents.markProcessed(tx, event.id, 'unmatched', null, ctx.clock.now()),
    );
    return { kind: 'unmatched' };
  }
  const outcome = await settle(ctx, payment);
  if (!outcome.ok && outcome.reason === 'unavailable') {
    throw new Error('PayPal could not be reached to read the order back.');
  }
  await ctx.write((tx) =>
    providerEvents.markProcessed(tx, event.id, 'settled', payment.id, ctx.clock.now()),
  );
  return { kind: 'processed' };
}

function parseEvent(rawBody: string): PayPalEvent | undefined {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(rawBody));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const CAPTURE_LINK = /\/v2\/payments\/captures\/([^/?#]+)/;

/** The PayPal order or capture an event is about. */
function paypalIds(event: PayPalEvent): { orderId?: string; captureId?: string } {
  const resource = event.resource;
  const relatedOrder = resource?.supplementary_data?.related_ids?.order_id;
  if (event.resource_type === 'checkout-order') {
    return resource?.id === undefined ? {} : { orderId: resource.id };
  }
  if (event.resource_type === 'refund') {
    const up = resource?.links?.find((link) => link.rel === 'up');
    const captureId = up === undefined ? undefined : CAPTURE_LINK.exec(up.href)?.[1];
    return captureId === undefined ? {} : { captureId };
  }
  const captureId = event.resource_type === 'capture' ? resource?.id : undefined;
  return {
    ...(relatedOrder === undefined ? {} : { orderId: relatedOrder }),
    ...(captureId === undefined ? {} : { captureId }),
  };
}
