import type { CreateOrderInput, OrderPresentation } from './gateway.js';
import { toPayPalAmount } from './schemas.js';

/** PayPal shows at most 127 characters of an item's name. */
const ITEM_NAME_LIMIT = 127;

/**
 * The body of `POST /v2/checkout/orders`. With a presentation, the PayPal window shows MovIQ's
 * name in the traveller's language and the lines of the purchase: each at its menu price, the
 * reward as the discount, and the total the server set.
 */
export function orderBody(input: CreateOrderInput): string {
  const presentation = input.presentation;
  return JSON.stringify({
    intent: input.intent,
    purchase_units: [
      {
        reference_id: input.referenceId,
        description: input.description,
        ...(presentation === undefined
          ? { amount: toPayPalAmount(input.amount) }
          : itemised(input, presentation)),
      },
    ],
    payment_source:
      input.billingAgreementId === undefined
        ? {
            paypal: {
              experience_context: {
                ...(presentation === undefined
                  ? {}
                  : { brand_name: presentation.brandName, locale: presentation.locale }),
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
              },
            },
          }
        : { token: { id: input.billingAgreementId, type: 'BILLING_AGREEMENT' } },
  });
}

function itemised(input: CreateOrderInput, presentation: OrderPresentation) {
  const itemTotal = presentation.items.reduce(
    (sum, item) => sum + item.unitAmount.amountMinor * item.quantity,
    0,
  );
  if (itemTotal - presentation.discount.amountMinor !== input.amount.amountMinor) {
    throw new RangeError('The items less the discount must add up to the amount.');
  }
  const currency = input.amount.currency;
  return {
    amount: {
      ...toPayPalAmount(input.amount),
      breakdown: {
        item_total: toPayPalAmount({ amountMinor: itemTotal, currency }),
        ...(presentation.discount.amountMinor === 0
          ? {}
          : { discount: toPayPalAmount(presentation.discount) }),
      },
    },
    items: presentation.items.map((item) => ({
      name: item.name.slice(0, ITEM_NAME_LIMIT),
      quantity: String(item.quantity),
      unit_amount: toPayPalAmount(item.unitAmount),
      category: item.category,
    })),
  };
}
