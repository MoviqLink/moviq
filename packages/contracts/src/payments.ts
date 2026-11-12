import { z } from 'zod';

import { moneySchema } from './money.js';
import { instantSchema } from './time.js';

/** What a payment is for. The server prices it; the client never sends an amount. */
export const paymentPurposeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ticket-product'), intentId: z.uuid() }),
  /** Money added to the trip wallet; the amount is the one the server recorded for `topUpId`. */
  z.strictObject({ kind: z.literal('wallet-top-up'), topUpId: z.uuid() }),
  z.object({
    kind: z.literal('journey-alternative'),
    journeyId: z.string().min(1),
    alternativeId: z.string().min(1),
  }),
]);

export type PaymentPurpose = z.infer<typeof paymentPurposeSchema>;

/** `POST /api/payments/orders`. */
export const createPaymentRequestSchema = z.object({ purpose: paymentPurposeSchema });

export const paymentStatusSchema = z.enum([
  'created',
  'approved',
  'authorized',
  'captured',
  'voided',
  'refunded',
  'failed',
  /** The provider's answer is not known yet; reconciliation will settle it. */
  'unknown',
]);

/** A payment operation as MovIQ records it, with the PayPal order it maps to. */
export const paymentSchema = z.object({
  id: z.string().min(1),
  paypalOrderId: z.string().min(1),
  status: paymentStatusSchema,
  amount: moneySchema,
  description: z.string().min(1),
  purpose: paymentPurposeSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export type Payment = z.infer<typeof paymentSchema>;

/** `GET /api/payments/config`: what the PayPal button needs, or why payments are unavailable. */
export const paymentsConfigSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    clientId: z.string().min(1),
    environment: z.enum(['sandbox', 'live']),
    currency: z.literal('USD'),
  }),
  z.object({ available: z.literal(false), reason: z.string().min(1) }),
]);

export type PaymentsConfig = z.infer<typeof paymentsConfigSchema>;
