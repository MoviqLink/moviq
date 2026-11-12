import { z } from 'zod';

import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

export const ticketCategorySchema = z.enum(['subway', 'train', 'bus', 'airport', 'port']);

/** A sandbox demonstration priced against a published fare, not a transport entitlement. */
export const ticketProductSchema = z.object({
  id: z.string().min(1),
  category: ticketCategorySchema,
  name: z.string().min(1),
  operator: z.string().min(1),
  description: z.string().min(1),
  price: moneySchema,
  rides: z.number().int().positive(),
  officialUrl: z.url(),
  fareVerifiedAt: z.iso.date(),
});
export type TicketProduct = z.infer<typeof ticketProductSchema>;

export const ticketCatalogSchema = z.object({
  demo: z.literal(true),
  products: z.array(ticketProductSchema),
  notice: z.string(),
  information: z.array(
    z.object({
      id: z.string(),
      category: ticketCategorySchema,
      name: z.string(),
      description: z.string(),
      officialUrl: z.url(),
    }),
  ),
});
export type TicketCatalog = z.infer<typeof ticketCatalogSchema>;
export const createTicketIntentSchema = z.strictObject({
  productId: z.string().min(1).max(100),
});
export const ticketIntentSchema = z.object({
  id: z.uuid(),
  product: ticketProductSchema,
  purpose: z.object({ kind: z.literal('ticket-product'), intentId: z.uuid() }),
});
export type TicketIntent = z.infer<typeof ticketIntentSchema>;
export const ticketWalletSchema = z.object({
  demo: z.literal(true),
  hasMore: z.boolean(),
  notice: z.string(),
  items: z.array(
    z.object({
      id: z.uuid(),
      product: ticketProductSchema,
      paymentId: z.string(),
      paypalOrderId: z.string().nullable(),
      paypalCaptureId: z.string().nullable(),
      status: z.enum(['captured', 'refunded']),
      createdAt: instantSchema,
    }),
  ),
});
export type TicketWallet = z.infer<typeof ticketWalletSchema>;
export const ticketDemoStatusSchema = z.object({ enabled: z.boolean() });
export const ticketDemoSessionSchema = z.object({ demo: z.literal(true) });
export const ticketDemoPartnerSchema = z.object({
  demo: z.literal(true),
  notice: z.string(),
  hasMore: z.boolean(),
  totals: z.object({
    sales: z.number().int().nonnegative(),
    refunded: z.number().int().nonnegative(),
    amountMinor: z.number().int().nonnegative(),
    refundedMinor: z.number().int().nonnegative(),
    netMinor: z.number().int().nonnegative(),
    currency: z.literal('USD'),
  }),
  items: z.array(
    z.object({
      id: z.uuid(),
      paymentId: z.string(),
      paypalOrderId: z.string().nullable(),
      paypalCaptureId: z.string().nullable(),
      product: ticketProductSchema,
      amountMinor: z.number().int().nonnegative(),
      currency: z.string(),
      refundedMinor: z.number().int().nonnegative(),
      netMinor: z.number().int().nonnegative(),
      status: z.enum(['captured', 'refunded']),
      createdAt: instantSchema,
    }),
  ),
});
export type TicketDemoPartner = z.infer<typeof ticketDemoPartnerSchema>;

/** Explicitly enabled sandbox test-buyer access, never merchant credentials. */
export const demoBuyerStatusSchema = z.object({ available: z.boolean() });
export const demoBuyerSchema = z.strictObject({ email: z.email(), password: z.string().min(1) });

/**
 * Whether the traveller has let the assistant pay with PayPal: one approval of a PayPal billing
 * agreement, after which the assistant buys tickets without the PayPal window.
 */
export const ticketAutopaySchema = z.object({
  /** False when PayPal is not configured in sandbox: nothing can be connected. */
  available: z.boolean(),
  /** The traveller's own switch, on until they turn it off: off, the assistant buys nothing. */
  enabled: z.boolean(),
  connected: z.boolean(),
  connectedAt: instantSchema.nullable(),
  /** Connected through the server's sandbox test buyer: nothing to approve or to disconnect. */
  testBuyer: z.boolean(),
});
export type TicketAutopay = z.infer<typeof ticketAutopaySchema>;
export const ticketAutopaySwitchSchema = z.strictObject({ enabled: z.boolean() });
/** Where the traveller approves the agreement, in PayPal. */
export const ticketAutopaySetupSchema = z.object({ approvalUrl: z.url() });
