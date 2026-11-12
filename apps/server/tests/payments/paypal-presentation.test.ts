import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PayPalError } from '../../src/modules/payments/paypal/errors.js';
import { orderBody } from '../../src/modules/payments/paypal/order-body.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { fixture } from './support/fixtures.js';
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

const payoutFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/payouts/${name}`, import.meta.url), 'utf8'));

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });
const presentation = {
  brandName: 'MovIQ',
  locale: 'es-US' as const,
  items: [
    {
      name: 'Vegan miso ramen (no scallions)',
      quantity: 1,
      unitAmount: usd(1695),
      category: 'PHYSICAL_GOODS' as const,
    },
    { name: 'Cola', quantity: 1, unitAmount: usd(300), category: 'PHYSICAL_GOODS' as const },
  ],
  discount: usd(299),
};

const sentSchema = z.object({
  intent: z.string(),
  purchase_units: z.array(
    z.object({
      amount: z.object({
        value: z.string(),
        breakdown: z.object({
          item_total: z.object({ value: z.string() }),
          discount: z.object({ value: z.string() }),
        }),
      }),
      items: z.array(
        z.object({
          name: z.string(),
          quantity: z.string(),
          unit_amount: z.object({ value: z.string() }),
        }),
      ),
    }),
  ),
  payment_source: z.object({
    paypal: z.object({ experience_context: z.record(z.string(), z.string()) }),
  }),
});

describe('the PayPal window shows MovIQ, in the traveller language, with the lines and the reward', () => {
  it('sends the brand, the locale and the breakdown: menu prices, the reward as discount, the total', async () => {
    paypal.answer = () => ({ status: 201, body: fixture('orders-create.json') });
    await paypal.client().createOrder({
      intent: 'AUTHORIZE',
      amount: usd(1696),
      presentation,
      description: 'Tsuki Ramen House (demo), pickup at 18:30',
      referenceId: 'hold-1',
      requestId: 'hold-1:create',
    });
    const sent = sentSchema.parse(JSON.parse(paypal.api()[0]?.body ?? '{}'));
    expect(sent.intent).toBe('AUTHORIZE');
    expect(sent.payment_source.paypal.experience_context).toEqual({
      brand_name: 'MovIQ',
      locale: 'es-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'PAY_NOW',
    });
    const unit = sent.purchase_units[0];
    expect(unit?.amount.value).toBe('16.96');
    expect(unit?.amount.breakdown).toEqual({
      item_total: { value: '19.95' },
      discount: { value: '2.99' },
    });
    expect(unit?.items.map((item) => [item.name, item.quantity, item.unit_amount.value])).toEqual([
      ['Vegan miso ramen (no scallions)', '1', '16.95'],
      ['Cola', '1', '3.00'],
    ]);
  });

  it('refuses lines that do not add up to the amount, before PayPal', () => {
    expect(() =>
      orderBody({
        intent: 'AUTHORIZE',
        amount: usd(1500),
        presentation,
        description: 'x',
        referenceId: 'r',
        requestId: 'r:create',
      }),
    ).toThrow(RangeError);
  });
});

describe('PayPal Payouts against the guide examples', () => {
  const client = () => paypal.payouts();

  it('sends one batch under its own id, as sender batch id and request id, and reads it back', async () => {
    paypal.answer = (request) =>
      request.method === 'POST'
        ? { status: 201, body: payoutFixture('payouts-create.json') }
        : { status: 200, body: payoutFixture('payouts-get.json') };
    const created = await client().createBatch({
      senderBatchId: 'batch-1',
      emailSubject: 'Your MovIQ payout',
      receiver: 'demo@example.com',
      amount: usd(1611),
      note: 'MovIQ sales',
    });
    expect(created.batch_header).toMatchObject({
      payout_batch_id: '3TRXJ4Z8XJ8QY',
      batch_status: 'PENDING',
    });
    const [request] = paypal.api();
    expect(request?.path).toBe('/api-m.sandbox.paypal.com/v1/payments/payouts');
    expect(request?.headers['paypal-request-id']).toBe('batch-1');
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({
      sender_batch_header: { sender_batch_id: 'batch-1' },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: 'demo@example.com',
          amount: { value: '16.11', currency: 'USD' },
        },
      ],
    });
    const read = await client().getBatch('MJ77GF8MQ2TF6');
    expect(read.batch_header.batch_status).toBe('SUCCESS');
    expect(read.items).toHaveLength(3);
  });

  it('reports an account PayPal does not let pay out as refused, with its issue', async () => {
    paypal.answer = () => ({
      status: 403,
      body: payoutFixture('payouts-create-403-sender-email-unconfirmed.json'),
    });
    const error: unknown = await client()
      .createBatch({
        senderBatchId: 'batch-2',
        emailSubject: 's',
        receiver: 'demo@example.com',
        amount: usd(100),
        note: 'n',
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(error).toBeInstanceOf(PayPalError);
    expect(error instanceof PayPalError && [error.outcome, error.issue]).toEqual([
      'refused',
      'SENDER_EMAIL_UNCONFIRMED',
    ]);
  });
});
