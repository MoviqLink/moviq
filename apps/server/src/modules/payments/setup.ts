import type { PaymentsConfig } from '@moviq/contracts';

import type { AppConfig } from '../../config/config.js';
import type { Clock } from '../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../infrastructure/http/client.js';
import { createPayPalAgreements, type PayPalAgreements } from './paypal/agreements.js';
import { createPayPalClient } from './paypal/client.js';
import type { PayPalGateway } from './paypal/gateway.js';

/** Whether this server can take payments, with the PayPal client when it can. */
export type PaymentsSetup =
  | {
      readonly available: true;
      readonly paypal: PayPalGateway;
      /** One approval, then orders with no window: what the assistant pays tickets with. */
      readonly agreements?: PayPalAgreements;
      readonly config: Extract<PaymentsConfig, { available: true }>;
      /** Undefined while `PAYPAL_WEBHOOK_ID` is not set: reconciliation alone keeps up. */
      readonly webhookId: string | undefined;
    }
  | { readonly available: false; readonly reason: string };

/** Reads the PayPal integrations. Without credentials payments are off, and the reason says why. */
export function paymentsSetup(input: {
  readonly config: Pick<AppConfig, 'integrations' | 'paypalEnv'>;
  readonly http: HttpClient;
  readonly clock: Clock;
}): PaymentsSetup {
  const paypal = input.config.integrations.find((integration) => integration.id === 'paypal');
  if (paypal?.state !== 'configured') {
    const missing = paypal?.missing ?? [];
    const names = missing.length === 0 ? 'its credentials' : missing.join(' and ');
    return {
      available: false,
      reason: `PayPal is not set up on this server (${names} not set).`,
    };
  }
  const webhooks = input.config.integrations.find(
    (integration) => integration.id === 'paypal-webhooks',
  );
  const clientId = paypal.credentials.PAYPAL_CLIENT_ID.reveal();
  const client = {
    http: input.http,
    environment: input.config.paypalEnv,
    clientId,
    clientSecret: paypal.credentials.PAYPAL_CLIENT_SECRET,
    clock: input.clock,
  };
  return {
    available: true,
    paypal: createPayPalClient(client),
    agreements: createPayPalAgreements(client),
    config: { available: true, clientId, environment: input.config.paypalEnv, currency: 'USD' },
    webhookId:
      webhooks?.state === 'configured'
        ? webhooks.credentials.PAYPAL_WEBHOOK_ID.reveal()
        : undefined,
  };
}
