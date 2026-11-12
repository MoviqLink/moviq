import type { PaymentsConfig } from '@moviq/contracts';
import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { tripApi } from '../api';
import type { Checkout } from './flow';
import { loadCheckout } from './paypal';

export type CheckoutState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'not-eligible' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly checkout: Checkout; readonly sandbox: boolean };

type Settled = Exclude<CheckoutState, { status: 'loading' }>;

async function settle(config: PaymentsConfig, locale: string): Promise<Settled> {
  if (!config.available) return { status: 'unavailable', reason: config.reason };
  const loaded = await loadCheckout(config, locale);
  if (loaded.status === 'not-eligible') return loaded;
  loaded.setLocale(locale);
  return { status: 'ready', checkout: loaded.checkout, sandbox: config.environment === 'sandbox' };
}

/**
 * Asks the server whether payments are available and, if so, loads PayPal's SDK. `attempt`
 * starts again after a failure; the language follows the page.
 */
export function useCheckout(locale: string, attempt: number): CheckoutState {
  const [state, setState] = useState<{ attempt: number; value: CheckoutState }>({
    attempt,
    value: { status: 'loading' },
  });
  useEffect(() => {
    const controller = new AbortController();
    tripApi
      .paymentsConfig(controller.signal)
      .then((config) => settle(config, locale))
      .then(
        (value) => {
          if (!controller.signal.aborted) setState({ attempt, value });
        },
        (error: unknown) => {
          if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
          if (!controller.signal.aborted) setState({ attempt, value: { status: 'failed' } });
        },
      );
    return () => {
      controller.abort();
    };
  }, [locale, attempt]);
  return state.attempt === attempt ? state.value : { status: 'loading' };
}
