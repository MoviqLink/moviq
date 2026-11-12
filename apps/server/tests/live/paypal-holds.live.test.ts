import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/config.js';
import { systemClock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import type { CreateOrderInput } from '../../src/modules/payments/paypal/gateway.js';
import { payoutsSetup } from '../../src/modules/payments/payouts/payouts-setup.js';
import { paymentsSetup } from '../../src/modules/payments/setup.js';

/**
 * Commerce against the real PayPal sandbox, with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`:
 * an order of intent AUTHORIZE with MovIQ's name, the Spanish window and the itemised reward is
 * accepted, reads back at its total, and cannot be authorized before a buyer approves it, so no
 * money is held. Then one sandbox payout of 1.00 USD to an example address shows whether the
 * sandbox account may send Payouts. It never runs against the live environment.
 */
const loaded = loadConfig(process.env);
if (!loaded.ok) throw new Error(`Configuration error: ${loaded.problems.join('; ')}`);
const http = createHttpClient();
const setup = paymentsSetup({ config: loaded.config, http, clock: systemClock });
const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });

describe('commerce on the PayPal sandbox', () => {
  it('opens a branded, itemised AUTHORIZE order and refuses to hold it unapproved', async () => {
    expect(loaded.config.paypalEnv, 'live tests only run against the PayPal sandbox').toBe(
      'sandbox',
    );
    if (!setup.available) expect.fail(setup.reason);
    const reference = randomUUID();
    const input: CreateOrderInput = {
      intent: 'AUTHORIZE',
      amount: usd(1696),
      presentation: {
        brandName: 'MovIQ',
        locale: 'es-US',
        items: [
          {
            name: 'Vegan miso ramen (no scallions)',
            quantity: 1,
            unitAmount: usd(1695),
            category: 'PHYSICAL_GOODS',
          },
          { name: 'Cola', quantity: 1, unitAmount: usd(300), category: 'PHYSICAL_GOODS' },
        ],
        discount: usd(299),
      },
      description: 'Sandbox check (demo)',
      referenceId: reference,
      requestId: `${reference}:create`,
    };
    const order = await setup.paypal.createOrder(input);
    expect(['CREATED', 'PAYER_ACTION_REQUIRED']).toContain(order.status);
    const read = await setup.paypal.getOrder(order.id);
    expect(read.purchase_units?.[0]?.amount).toEqual(input.amount);
    const refusal: unknown = await setup.paypal
      .authorizeOrder(order.id, `${reference}:authorize`)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal instanceof PayPalError ? [refusal.outcome, refusal.issue] : refusal).toEqual([
      'refused',
      expect.stringMatching(/^(ORDER_NOT_APPROVED|PAYER_ACTION_REQUIRED)$/),
    ]);
  }, 60_000);

  it('reads a refund back by id, and names one it does not have as not found', async () => {
    expect(loaded.config.paypalEnv, 'live tests only run against the PayPal sandbox').toBe(
      'sandbox',
    );
    if (!setup.available) expect.fail(setup.reason);
    const missing: unknown = await setup.paypal.getRefund('0MOVIQ0SANDBOX0CHECK').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(missing instanceof PayPalError ? [missing.outcome, missing.status] : missing).toEqual([
      'refused',
      404,
    ]);
  }, 60_000);

  it('sends one sandbox payout, or names why the sandbox account cannot', async () => {
    const payouts = payoutsSetup({ config: loaded.config, http, clock: systemClock });
    if (payouts === undefined) expect.fail('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set');
    const batchId = randomUUID();
    const answer = await payouts
      .createBatch({
        senderBatchId: batchId,
        emailSubject: 'MovIQ sandbox check',
        receiver: 'payouts-check@example.com',
        amount: usd(100),
        note: 'Sandbox check',
      })
      .then(
        (batch) => batch.batch_header.batch_status,
        (error: unknown) =>
          error instanceof PayPalError
            ? `${error.outcome} ${String(error.status)} ${error.issue ?? ''} ${error.debugId ?? ''}`
            : String(error),
      );
    expect(answer, 'what the sandbox answered to a payout').toMatch(
      /^(PENDING|PROCESSING|SUCCESS)$/,
    );
  }, 60_000);
});
