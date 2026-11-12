import {
  createWalletTopUpSchema,
  tripWalletSchema,
  walletTopUpSchema,
  type TripWallet,
  type WalletTopUp,
} from '@moviq/contracts';

import { api, type ApiClient } from '../../shared/api/client';

const BASE = '/api/wallet';

/** The trip wallet's endpoints. Every server answer is checked against the shared contract. */
function createWalletApi(client: ApiClient) {
  return {
    /** Balance, totals and the latest movements. */
    wallet: (signal: AbortSignal): Promise<TripWallet> =>
      client.json(BASE, tripWalletSchema, { signal }),
    /**
     * Records a top-up of `amountMinor` cents. Its `purpose` is then paid with PayPal like any
     * other payment (`/api/payments/orders`); the balance grows once PayPal confirms it.
     */
    topUp: (amountMinor: number): Promise<WalletTopUp> =>
      client.json(`${BASE}/top-ups`, walletTopUpSchema, {
        method: 'POST',
        body: createWalletTopUpSchema.parse({ amountMinor }),
      }),
    /**
     * Adds `amountMinor` cents with the PayPal already connected, with no PayPal window; the
     * answer is the wallet with its new balance. Refused when PayPal is not connected.
     */
    addWithConnectedPayPal: (amountMinor: number): Promise<TripWallet> =>
      client.json(`${BASE}/top-ups/paypal`, tripWalletSchema, {
        method: 'POST',
        body: createWalletTopUpSchema.parse({ amountMinor }),
        timeoutMs: 30_000,
      }),
  };
}

export const walletApi = createWalletApi(api);
