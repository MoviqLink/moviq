import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { fixture, fixtureWith } from './support/fixtures.js';
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
const exampleToken = () =>
  z.object({ access_token: z.string() }).parse(fixture('oauth-token.json')).access_token;

async function failure(promise: Promise<unknown>): Promise<PayPalError> {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof PayPalError)) throw new Error('expected a PayPalError');
  return error;
}

describe('the PayPal client against the official examples', () => {
  it('creates an order with an opaque reference and a stable request id, and nothing internal', async () => {
    paypal.answer = () => ({ status: 201, body: fixture('orders-create.json') });
    const order = await paypal.client().createOrder({
      intent: 'CAPTURE',
      amount: { amountMinor: 2140, currency: 'USD' },
      description: 'Taxi to JFK',
      referenceId: 'payment-7f3a',
      requestId: 'payment-7f3a:create',
    });
    expect(order.id).toBe('5O190127TN364715T');
    const [request] = paypal.api();
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe(`${SANDBOX}/v2/checkout/orders`);
    expect(request?.headers['paypal-request-id']).toBe('payment-7f3a:create');
    expect(request?.headers['prefer']).toBe('return=representation');
    expect(request?.headers.authorization).toBe(`Bearer ${exampleToken()}`);
    expect(JSON.parse(request?.body ?? '')).toEqual({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'payment-7f3a',
          description: 'Taxi to JFK',
          amount: { currency_code: 'USD', value: '21.40' },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
        },
      },
    });
  });

  it('reads an order and keeps none of the payer data PayPal returns', async () => {
    paypal.answer = () => ({ status: 200, body: fixture('orders-get.json') });
    const order = await paypal.client().getOrder('5O190127TN364715T');
    expect(order.purchase_units?.[0]?.amount).toEqual({ amountMinor: 10000, currency: 'USD' });
    // The official example has no status: it is optional, and nothing is guessed in its place.
    expect(order.status).toBeUndefined();
    expect(JSON.stringify(order)).not.toMatch(/customer@example\.com|John|QYR5Z8XDVJNXQ/);
    expect(paypal.api()[0]?.headers['paypal-request-id']).toBeUndefined();
  });

  it('captures an order, sending the same request id on every attempt', async () => {
    paypal.answer = () => ({ status: 201, body: fixture('orders-capture.json') });
    const gateway = paypal.client();
    const first = await gateway.captureOrder('5O190127TN364715T', 'payment-7f3a:capture');
    paypal.answer = () => ({ status: 200, body: fixture('orders-capture.json') });
    const again = await gateway.captureOrder('5O190127TN364715T', 'payment-7f3a:capture');
    expect(first.purchase_units?.[0]?.payments?.captures?.[0]).toMatchObject({
      id: '3C679366HH908993F',
      status: 'COMPLETED',
      amount: { amountMinor: 10000, currency: 'USD' },
    });
    expect(again).toEqual(first);
    expect(paypal.api().map((request) => request.headers['paypal-request-id'])).toEqual([
      'payment-7f3a:capture',
      'payment-7f3a:capture',
    ]);
    expect(paypal.api()[0]?.path).toBe(`${SANDBOX}/v2/checkout/orders/5O190127TN364715T/capture`);
  });

  it('authorizes an order, captures part of the authorization and voids one', async () => {
    const gateway = paypal.client();
    paypal.answer = () => ({ status: 201, body: fixture('orders-authorize.json') });
    const held = await gateway.authorizeOrder('5O190127TN364715T', 'p:authorize');
    expect(held.purchase_units?.[0]?.payments?.authorizations?.[0]?.status).toBe('CREATED');
    paypal.answer = () => ({ status: 201, body: fixture('authorizations-capture.json') });
    const capture = await gateway.captureAuthorization('0VF52814937998046', {
      amount: { amountMinor: 1099, currency: 'USD' },
      finalCapture: true,
      requestId: 'p:capture-authorization',
    });
    expect(capture).toMatchObject({ id: '2GG279541U471931P', amount: { amountMinor: 1099 } });
    expect(JSON.parse(paypal.api()[1]?.body ?? '')).toEqual({
      amount: { currency_code: 'USD', value: '10.99' },
      final_capture: true,
    });
    paypal.answer = () => ({ status: 200, body: fixture('authorizations-void.json') });
    expect((await gateway.voidAuthorization('5C908745JK343851U', 'p:void'))?.status).toBe('VOIDED');
    paypal.answer = () => ({ status: 204 });
    expect(await gateway.voidAuthorization('5C908745JK343851U', 'p:void')).toBeUndefined();
  });

  it('refunds in part and in full, each operation with its own request id', async () => {
    const gateway = paypal.client();
    paypal.answer = () => ({ status: 201, body: fixture('captures-refund.json') });
    const part = await gateway.refundCapture('2GG279541U471931P', {
      amount: { amountMinor: 1099, currency: 'USD' },
      requestId: 'p:refund:1',
    });
    paypal.answer = () => ({ status: 201, body: fixture('captures-refund-full.json') });
    const rest = await gateway.refundCapture('7TK53561YB803214S', { requestId: 'p:refund:2' });
    expect(part).toMatchObject({
      id: '1JU08902781691411',
      status: 'COMPLETED',
      amount: { amountMinor: 1099 },
    });
    expect(rest).toMatchObject({ id: '58K15806CS993444T', amount: { amountMinor: 8900 } });
    expect(paypal.api().map((request) => JSON.parse(request.body) as unknown)).toEqual([
      { amount: { currency_code: 'USD', value: '10.99' } },
      {},
    ]);
    expect(paypal.api().map((request) => request.headers['paypal-request-id'])).toEqual([
      'p:refund:1',
      'p:refund:2',
    ]);
  });

  it("sends the refund's own reference as custom_id and reads it back", async () => {
    paypal.answer = () => ({ status: 200, body: fixture('captures-refund-200-idempotent.json') });
    const refund = await paypal.client().refundCapture('2GG279541U471931P', {
      amount: { amountMinor: 100, currency: 'USD' },
      customId: 'RefundCustom-14_10_2024_4_58_32_pm',
      requestId: 'h:refund:missing:0',
    });
    expect(refund).toMatchObject({
      id: '0K35355239430361V',
      status: 'COMPLETED',
      custom_id: 'RefundCustom-14_10_2024_4_58_32_pm',
    });
    expect(JSON.parse(paypal.api()[0]?.body ?? '') as unknown).toEqual({
      amount: { currency_code: 'USD', value: '1.00' },
      custom_id: 'RefundCustom-14_10_2024_4_58_32_pm',
    });
  });

  it('reads a refund back by its id, to follow one PayPal left pending', async () => {
    const gateway = paypal.client();
    paypal.answer = () => ({
      status: 200,
      body: fixtureWith('captures-refund.json', { status: 'PENDING' }),
    });
    const refund = await gateway.getRefund('1JU08902781691411');
    expect(refund).toMatchObject({ id: '1JU08902781691411', status: 'PENDING' });
    expect(paypal.api()[0]).toMatchObject({ method: 'GET' });
    expect(paypal.api()[0]?.path).toMatch(/\/v2\/payments\/refunds\/1JU08902781691411$/);
  });

  it('uses the sandbox or the live host as configured', async () => {
    paypal.answer = () => ({ status: 200, body: fixture('orders-get.json') });
    await paypal.client('live').getOrder('5O190127TN364715T');
    expect(paypal.seen.map((request) => request.path.split('/')[1])).toEqual([
      'api-m.paypal.com',
      'api-m.paypal.com',
    ]);
  });
});

describe('the OAuth2 token', () => {
  it('is fetched once with the client credentials and reused until it nearly expires', async () => {
    paypal.answer = () => ({ status: 200, body: fixture('orders-get.json') });
    const gateway = paypal.client();
    await Promise.all([gateway.getOrder('A'), gateway.getOrder('B'), gateway.getOrder('C')]);
    expect(paypal.tokens()).toHaveLength(1);
    expect(paypal.tokens()[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('client-id-for-tests:client-secret-for-tests').toString('base64')}`,
    );
    expect(paypal.tokens()[0]?.body).toBe('grant_type=client_credentials');
    // The example token lasts 31 668 s; it is renewed one minute before.
    clock.advance((31_668 - 61) * 1000);
    await gateway.getOrder('D');
    expect(paypal.tokens()).toHaveLength(1);
    clock.advance(2_000);
    await gateway.getOrder('E');
    expect(paypal.tokens()).toHaveLength(2);
  });

  it('is renewed when PayPal refuses it, and the call is repeated with the same request id', async () => {
    let calls = 0;
    paypal.answer = () => {
      calls += 1;
      return calls === 1
        ? { status: 401, body: { name: 'AUTHENTICATION_FAILURE', message: 'Token expired' } }
        : { status: 201, body: fixture('orders-capture.json') };
    };
    await paypal.client().captureOrder('5O190127TN364715T', 'p:capture');
    expect(paypal.tokens()).toHaveLength(2);
    expect(paypal.api().map((request) => request.headers['paypal-request-id'])).toEqual([
      'p:capture',
      'p:capture',
    ]);
  });

  it('that cannot be obtained means nothing was done', async () => {
    paypal.refuseCredentials();
    const error = await failure(paypal.client().getOrder('A'));
    expect(error).toMatchObject({
      outcome: 'not_done',
      operation: 'oauth2.token',
      issue: 'invalid_client',
    });
  });
});
