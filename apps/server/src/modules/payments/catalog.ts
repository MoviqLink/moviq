import type { Transaction } from '@libsql/client';
import type { Money, PaymentPurpose } from '@moviq/contracts';

/**
 * Everything MovIQ can sell, priced by the module that owns it. Payments asks for a quote before
 * creating an order and calls `fulfil` only after the provider confirmed the money, in the same
 * transaction that records the confirmation.
 */
export interface PurchaseCatalog {
  quote(purpose: PaymentPurpose, travellerId: string): Promise<PurchaseQuote>;
  fulfil(purpose: PaymentPurpose, paymentId: string, tx: Transaction): Promise<void>;
}

export type PurchaseQuote =
  | { readonly ok: true; readonly amount: Money; readonly description: string }
  | { readonly ok: false; readonly reason: string };
