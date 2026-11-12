import type { PaymentPurpose } from '@moviq/contracts';

import { MESSAGES, ok, refused, type Outcome, type PaymentContext } from './context.js';
import type { PurchaseQuote } from './catalog.js';
import { paymentLedger, StalePaymentError, type PaymentRecord } from './ledger.js';
import { captureOrder, settle, stillOnSale } from './settlement.js';
import { openOrder } from './steps.js';

/** PayPal shows at most 127 characters of a description. */
const DESCRIPTION_LIMIT = 127;
/** A new payment opens its order at once; reconciliation steps in only if that is lost. */
const FIRST_CHECK_MS = 2 * 60_000;
/** Each attempt starts from a fresher payment; racing writers settle within a few. */
const CONFIRM_ATTEMPTS = 4;

/**
 * Starts paying for a purchase. The price comes from the catalogue, never from the client. The
 * same purchase reuses its open payment, so a repeated request never opens a second order.
 */
export async function startPayment(
  ctx: PaymentContext,
  travellerId: string,
  purpose: PaymentPurpose,
  /** A billing agreement of this traveller: the order is charged to it, with no window. */
  billingAgreementId?: string,
): Promise<Outcome> {
  const quote = await ctx.catalog.quote(purpose, travellerId);
  if (!quote.ok) return refused(quote.reason);
  checkQuote(quote);
  const chosen = await ctx.write(async (tx): Promise<Outcome> => {
    const now = ctx.clock.now();
    const open = await paymentLedger.findOpen(tx, travellerId, purpose);
    if (open?.status === 'captured') return refused(MESSAGES.alreadyPaid, open);
    if (open !== undefined && sameQuote(open, quote)) return ok(open);
    if (open?.status === 'unknown' && open.pending !== 'create') {
      return refused(MESSAGES.confirming, open);
    }
    if (open !== undefined) {
      // Not paid and never shown at this price: it gives way to the current one.
      await paymentLedger.update(
        tx,
        open,
        { status: 'failed', pending: null, detail: 'Replaced at a new price.', nextCheckAt: null },
        ctx.source,
        now,
      );
    }
    const inserted = await paymentLedger.insert(
      tx,
      {
        travellerId,
        purpose,
        amount: quote.amount,
        description: quote.description,
        nextCheckAt: new Date(now.getTime() + FIRST_CHECK_MS),
      },
      ctx.source,
      now,
    );
    return ok(inserted);
  });
  if (!chosen.ok || chosen.payment.pending !== 'create') return chosen;
  return openOrder(ctx, chosen.payment, billingAgreementId);
}

/**
 * Charges an approved payment and applies its purchase. Repeating it never charges or applies
 * twice: a captured payment is returned as it is, and a capture in doubt is read back first.
 */
export async function confirmPayment(
  ctx: PaymentContext,
  payment: PaymentRecord,
): Promise<Outcome> {
  let current = payment;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await confirmOnce(ctx, current);
    } catch (error) {
      if (!(error instanceof StalePaymentError) || attempt === CONFIRM_ATTEMPTS) throw error;
      // Another request or the worker moved it meanwhile: decide again from what it is now.
      const latest = await paymentLedger.find(ctx.db, payment.id);
      if (latest === undefined) throw error;
      current = latest;
    }
  }
}

async function confirmOnce(ctx: PaymentContext, payment: PaymentRecord): Promise<Outcome> {
  switch (payment.status) {
    case 'captured':
      return ok(payment);
    case 'created':
    case 'approved': {
      const sale = await stillOnSale(ctx, payment);
      return sale.ok ? captureOrder(ctx, payment) : sale;
    }
    case 'unknown':
      return payment.pending === 'create'
        ? refused(MESSAGES.settingUp, payment)
        : settle(ctx, payment);
    case 'refunded':
      return refused(MESSAGES.refunded, payment);
    case 'voided':
      return refused(MESSAGES.voided, payment);
    case 'authorized':
    case 'failed':
      return refused(MESSAGES.failed, payment);
  }
}

/** A catalogue that prices something wrongly is a bug: it fails loudly, before PayPal. */
function checkQuote(quote: Extract<PurchaseQuote, { ok: true }>): void {
  if (!Number.isSafeInteger(quote.amount.amountMinor) || quote.amount.amountMinor <= 0) {
    throw new RangeError('The catalogue quoted an amount that is not a positive number of cents.');
  }
  const length = quote.description.trim().length;
  if (length === 0 || quote.description.length > DESCRIPTION_LIMIT) {
    throw new RangeError(
      `A payment description needs 1 to ${String(DESCRIPTION_LIMIT)} characters.`,
    );
  }
}

function sameQuote(payment: PaymentRecord, quote: Extract<PurchaseQuote, { ok: true }>): boolean {
  return (
    payment.amount.amountMinor === quote.amount.amountMinor &&
    payment.description === quote.description
  );
}
