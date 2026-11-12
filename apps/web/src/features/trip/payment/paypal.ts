import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6';
import type { PaymentsConfig } from '@moviq/contracts';

import type { Checkout } from './flow';

type Available = Extract<PaymentsConfig, { available: true }>;

export type CheckoutLoad =
  | {
      readonly status: 'ready';
      readonly checkout: Checkout;
      readonly setLocale: (l: string) => void;
    }
  /** PayPal says this buyer or browser cannot pay with PayPal here. */
  | { readonly status: 'not-eligible' };

async function load(config: Available, locale: string): Promise<CheckoutLoad> {
  const paypal = await loadCoreSdkScript({
    environment: config.environment === 'live' ? 'production' : 'sandbox',
  });
  if (paypal === null) throw new Error('The PayPal SDK did not load');
  const instance = await paypal.createInstance({
    clientId: config.clientId,
    components: ['paypal-payments'] as const,
    locale,
    pageType: 'checkout',
  });
  const methods = await instance.findEligibleMethods({ currencyCode: config.currency });
  if (!methods.isEligible('paypal')) return { status: 'not-eligible' };
  return {
    status: 'ready',
    setLocale: (next) => {
      instance.updateLocale(next);
    },
    checkout: {
      session(callbacks) {
        const session = instance.createPayPalOneTimePaymentSession({
          onApprove: (data) => callbacks.onApprove(data.orderId),
          onCancel: () => {
            callbacks.onCancel();
          },
          onError: () => {
            callbacks.onError();
          },
        });
        return {
          async start(order) {
            await session.start({ presentationMode: 'auto' }, order);
          },
        };
      },
    },
  };
}

const loads = new Map<string, Promise<CheckoutLoad>>();

/**
 * PayPal's web SDK (v6) for this client id, loaded once per visit. The SDK draws the official
 * `<paypal-button>` and opens the buyer's approval; the order is always created by our server.
 */
export function loadCheckout(config: Available, locale: string): Promise<CheckoutLoad> {
  const key = `${config.environment}|${config.clientId}`;
  let found = loads.get(key);
  if (found === undefined) {
    found = load(config, locale);
    loads.set(key, found);
    // A failed load can be tried again on the next visit to the payment.
    void found.catch(() => loads.delete(key));
  }
  return found;
}
