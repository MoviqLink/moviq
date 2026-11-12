import type { AppConfig } from '../../../config/config.js';
import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import { createPayPalPayouts, type PayPalPayouts } from '../paypal/payouts.js';

export type { PayPalPayouts } from '../paypal/payouts.js';

/** PayPal Payouts with the same credentials as payments, or undefined while they are not set. */
export function payoutsSetup(input: {
  readonly config: Pick<AppConfig, 'integrations' | 'paypalEnv'>;
  readonly http: HttpClient;
  readonly clock: Clock;
}): PayPalPayouts | undefined {
  const paypal = input.config.integrations.find((integration) => integration.id === 'paypal');
  if (paypal?.state !== 'configured') return undefined;
  return createPayPalPayouts({
    http: input.http,
    environment: input.config.paypalEnv,
    clientId: paypal.credentials.PAYPAL_CLIENT_ID.reveal(),
    clientSecret: paypal.credentials.PAYPAL_CLIENT_SECRET,
    clock: input.clock,
  });
}
