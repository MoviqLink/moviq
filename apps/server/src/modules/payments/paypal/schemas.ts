import type { Money } from '@moviq/contracts';
import { z } from 'zod';

/**
 * The parts of PayPal's answers that MovIQ reads, validated as they arrive. Anything else PayPal
 * sends, the payer's name and email included, is dropped here and never stored.
 */

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,2}))?$/;

/** PayPal writes amounts as decimal strings; MovIQ keeps integer minor units. */
const amountSchema = z
  .object({ currency_code: z.literal('USD'), value: z.string().regex(DECIMAL) })
  .transform((amount): Money => ({ amountMinor: toMinor(amount.value), currency: 'USD' }));

function toMinor(value: string): number {
  const [, units = '0', cents = ''] = DECIMAL.exec(value) ?? [];
  return Number(units) * 100 + Number(cents.padEnd(2, '0'));
}

export function toPayPalAmount(money: Money): { currency_code: 'USD'; value: string } {
  if (!Number.isSafeInteger(money.amountMinor) || money.amountMinor <= 0) {
    throw new RangeError('A PayPal amount must be a positive whole number of cents.');
  }
  const units = Math.trunc(money.amountMinor / 100);
  const cents = String(money.amountMinor % 100).padStart(2, '0');
  return { currency_code: money.currency, value: `${String(units)}.${cents}` };
}

const linkSchema = z.object({ href: z.string(), rel: z.string() });

export const captureSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['COMPLETED', 'DECLINED', 'PARTIALLY_REFUNDED', 'PENDING', 'REFUNDED', 'FAILED']),
  amount: amountSchema.optional(),
  final_capture: z.boolean().optional(),
});

export const authorizationSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['CREATED', 'CAPTURED', 'DENIED', 'PARTIALLY_CAPTURED', 'VOIDED', 'PENDING']),
  amount: amountSchema.optional(),
  expiration_time: z.string().optional(),
});

export const refundSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['CANCELLED', 'FAILED', 'PENDING', 'COMPLETED']),
  amount: amountSchema.optional(),
  custom_id: z.string().optional(),
  links: z.array(linkSchema).optional(),
});

/** An order. PayPal may leave out `status` (the reference examples do), so it is optional. */
export const orderSchema = z.object({
  id: z.string().min(1),
  status: z
    .enum(['CREATED', 'SAVED', 'APPROVED', 'VOIDED', 'COMPLETED', 'PAYER_ACTION_REQUIRED'])
    .optional(),
  purchase_units: z
    .array(
      z.object({
        reference_id: z.string().optional(),
        amount: amountSchema.optional(),
        payments: z
          .object({
            captures: z.array(captureSchema).optional(),
            authorizations: z.array(authorizationSchema).optional(),
            refunds: z.array(refundSchema).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  links: z.array(linkSchema).optional(),
});

export const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

export const verificationSchema = z.object({
  verification_status: z.enum(['SUCCESS', 'FAILURE']),
});

/** PayPal's error body, or the OAuth server's (`error`, `error_description`). */
export const errorBodySchema = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string(), description: z.string().optional() })).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export type PayPalOrder = z.infer<typeof orderSchema>;
export type PayPalCapture = z.infer<typeof captureSchema>;
export type PayPalAuthorization = z.infer<typeof authorizationSchema>;
export type PayPalRefund = z.infer<typeof refundSchema>;
