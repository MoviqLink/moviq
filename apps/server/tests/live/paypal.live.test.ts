import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import type { CreateOrderInput } from '../../src/modules/payments/paypal/gateway.js';
import { paymentsSetup } from '../../src/modules/payments/setup.js';

/**
 * The PayPal client against the real sandbox, with `PAYPAL_CLIENT_ID` and
 * `PAYPAL_CLIENT_SECRET`: it opens a real order, reads it back, checks that repeating the request
 * id returns the same order, and that PayPal refuses to capture it before a buyer approves it.
 * Nobody approves it, so it lapses on its own and no money moves. Without the keys it fails
 * naming the variables to set; it never runs against the live environment.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const setup = paymentsSetup({
  config: loaded.config,
  http: createHttpClient(),
  clock: systemClock,
});

describe('PayPal sandbox', () => {
  it('opens an order, reads it back and refuses to capture it unapproved', async () => {
    expect(loaded.config.paypalEnv, 'live tests only run against the PayPal sandbox').toBe(
      'sandbox',
    );
    if (!setup.available) expect.fail(setup.reason);
    const reference = randomUUID();
    const input: CreateOrderInput = {
      intent: 'CAPTURE',
      amount: { amountMinor: 100, currency: 'USD' },
      description: 'Sandbox check',
      referenceId: reference,
      requestId: `${reference}:create`,
    };
    const order = await setup.paypal.createOrder(input);
    expect(['CREATED', 'PAYER_ACTION_REQUIRED']).toContain(order.status);
    expect((await setup.paypal.createOrder(input)).id).toBe(order.id);

    const read = await setup.paypal.getOrder(order.id);
    expect(read.purchase_units?.[0]?.reference_id).toBe(reference);
    expect(read.purchase_units?.[0]?.amount).toEqual(input.amount);

    const refusal: unknown = await setup.paypal.captureOrder(order.id, `${reference}:capture`).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(PayPalError);
    expect(refusal instanceof PayPalError ? refusal.outcome : undefined).toBe('refused');
    expect(refusal instanceof PayPalError ? refusal.issue : undefined).toMatch(
      /^(ORDER_NOT_APPROVED|PAYER_ACTION_REQUIRED)$/,
    );
  }, 60_000);
});
