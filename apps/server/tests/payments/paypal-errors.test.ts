import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { fixture, fixtureText, fixtureWith } from './support/fixtures.js';
import { paypalServer, type PayPalServer } from './support/paypal-server.js';

let clock: ManualClock;
let paypal: PayPalServer;

beforeEach(async () => {
  clock = manualClock();
  paypal = await paypalServer(clock);
});

afterEach(async () => {
  await paypal.close();
});

const SANDBOX = '/api-m.sandbox.paypal.com';

async function failure(promise: Promise<unknown>): Promise<PayPalError> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof PayPalError)) throw new Error('expected a PayPalError');
  return error;
}

describe('PayPal errors, as typed errors that say whether money may have moved', () => {
  const capture = () => paypal.client().captureOrder('5O190127TN364715T', 'p:capture');

  it.each([
    ['orders-create-400-invalid-request.json', 400, 'INVALID_REQUEST', 'INVALID_ARRAY_MIN_ITEMS'],
    [
      'orders-capture-422-payer-action-required.json',
      422,
      'UNPROCESSABLE_ENTITY',
      'PAYER_ACTION_REQUIRED',
    ],
    [
      'orders-capture-422-action-does-not-match-intent.json',
      422,
      'UNPROCESSABLE_ENTITY',
      'ACTION_DOES_NOT_MATCH_INTENT',
    ],
    ['orders-authorize-422-payment-denied.json', 422, 'UNPROCESSABLE_ENTITY', 'PAYMENT_DENIED'],
    [
      'authorizations-capture-422-expired.json',
      422,
      'UNPROCESSABLE_ENTITY',
      'AUTHORIZATION_EXPIRED',
    ],
    [
      'authorizations-void-422-previously-captured.json',
      422,
      'UNPROCESSABLE_ENTITY',
      'PREVIOUSLY_CAPTURED',
    ],
    [
      'captures-refund-422-amount-exceeded.json',
      422,
      'UNPROCESSABLE_ENTITY',
      'REFUND_AMOUNT_EXCEEDED',
    ],
    ['orders-get-404-not-found.json', 404, 'RESOURCE_NOT_FOUND', 'RESOURCE_NOT_FOUND'],
  ])('%s is refused with its issue', async (name, status, errorName, issue) => {
    paypal.answer = () => ({ status, body: fixtureText(name) });
    const error = await failure(capture());
    expect(error.outcome).toBe('refused');
    expect(error.status).toBe(status);
    expect(error.issue).toBe(issue);
    // Two official examples spell the name UNPROCCESSABLE_ENTITY; it is kept as PayPal sent it.
    expect(error.errorName?.replace('UNPROCCESSABLE', 'UNPROCESSABLE')).toBe(errorName);
    expect(error.debugId).toEqual(expect.any(String));
  });

  it.each(['ORDER_NOT_APPROVED', 'INSTRUMENT_DECLINED', 'ORDER_ALREADY_CAPTURED'] as const)(
    '%s is recognised',
    async (issue) => {
      // The reference documents these issues without an example body: the 422 example is reused
      // with its issue replaced (Orders v2 errors, developer.paypal.com/api/rest/reference/orders/v2/errors/).
      paypal.answer = () => ({
        status: 422,
        body: fixtureWith('orders-capture-422-action-does-not-match-intent.json', {
          details: [{ issue, description: 'From the Orders v2 error reference.' }],
        }),
      });
      const error = await failure(capture());
      expect(error.is(issue)).toBe(true);
    },
  );

  it('server errors, time-outs and unreadable answers are unknown: PayPal may have acted', async () => {
    paypal.answer = () => ({
      status: 500,
      body: { name: 'INTERNAL_SERVER_ERROR', message: 'An internal server error occurred.' },
    });
    expect((await failure(capture())).outcome).toBe('unknown');
    paypal.answer = () => ({ status: 201, body: 'not json' });
    expect((await failure(capture())).outcome).toBe('unknown');
    paypal.answer = () => ({ status: 201, body: { id: 42 } });
    expect((await failure(capture())).outcome).toBe('unknown');
    paypal.answer = () => ({ status: 201, body: fixture('orders-capture.json'), delayMs: 500 });
    const slow = paypal.client('sandbox', 150);
    expect((await failure(slow.captureOrder('5O190127TN364715T', 'p:capture'))).outcome).toBe(
      'unknown',
    );
  });

  it('a request PayPal is still working on is unknown, never a refusal (regression)', async () => {
    paypal.answer = () => ({ status: 409, body: fixture('captures-refund-409-in-progress.json') });
    const refund = paypal.client().refundCapture('2GG279541U471931P', { requestId: 'h:refund:a' });
    expect(await failure(refund)).toMatchObject({
      outcome: 'unknown',
      status: 409,
      issue: 'PREVIOUS_REQUEST_IN_PROGRESS',
    });
  });

  it('a rate limit means nothing was done', async () => {
    paypal.answer = () => ({
      status: 429,
      body: { name: 'RATE_LIMIT_REACHED', message: 'Too many requests.' },
    });
    expect(await failure(capture())).toMatchObject({
      outcome: 'not_done',
      issue: 'RATE_LIMIT_REACHED',
    });
  });
});

describe('webhook verification', () => {
  const example = z
    .object({
      transmission_id: z.string(),
      transmission_time: z.string(),
      cert_url: z.string(),
      auth_algo: z.string(),
      transmission_sig: z.string(),
      webhook_id: z.string(),
      webhook_event: z.record(z.string(), z.unknown()),
    })
    .parse(fixture('verify-webhook-signature-request.json'));
  // The event exactly as it would arrive, with its own spacing.
  const rawEvent = JSON.stringify(example.webhook_event, null, 1);
  const headers = {
    authAlgo: example.auth_algo,
    certUrl: example.cert_url,
    transmissionId: example.transmission_id,
    transmissionSig: example.transmission_sig,
    transmissionTime: example.transmission_time,
  };

  it('sends the event back byte for byte with the signature headers and the webhook id', async () => {
    paypal.answer = () => ({ status: 200, body: { verification_status: 'SUCCESS' } });
    const verified = await paypal.client().verifyWebhookSignature({
      headers,
      rawEvent,
      webhookId: example.webhook_id,
    });
    expect(verified).toBe(true);
    const sent = paypal.api()[0]?.body ?? '';
    expect(sent.endsWith(`"webhook_event":${rawEvent}}`)).toBe(true);
    expect(JSON.parse(sent)).toEqual(example);
    expect(paypal.api()[0]?.path).toBe(`${SANDBOX}/v1/notifications/verify-webhook-signature`);
  });

  it('reports a refused signature, and refuses an event that is not JSON', async () => {
    paypal.answer = () => ({ status: 200, body: { verification_status: 'FAILURE' } });
    expect(
      await paypal.client().verifyWebhookSignature({ headers, rawEvent, webhookId: 'W' }),
    ).toBe(false);
    await expect(
      paypal.client().verifyWebhookSignature({
        headers,
        rawEvent: '{}, "webhook_id": "X"',
        webhookId: 'W',
      }),
    ).rejects.toThrow();
  });
});
