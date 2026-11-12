import { describe, expect, it } from 'vitest';

import { MERCHANT_TEST_TOKEN } from '../../../server/tests/support/merchant-access.js';

import { ApiRequestError } from '../../src/shared/api/errors';
import { createMerchantApi } from '../../src/features/merchant/api';

interface Call {
  readonly path: string;
  readonly method: string;
  readonly body: unknown;
}

const MERCHANT = {
  id: 'demo-tsuki-ramen-house',
  name: 'Tsuki Ramen House',
  kind: 'restaurant',
  demo: true,
  stop: { id: '403671', name: 'East 125th Street & Lexington Avenue', routes: ['M60'] },
  walkMinutes: 2,
  lat: 40.803558,
  lon: -73.937307,
};

/** An API double that answers each request with `answer` and records what was sent. */
function api(answer: (call: Call) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const merchant = createMerchantApi((path, init) => {
    const call = {
      path,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    const { status, body } = answer(call);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return { merchant, calls };
}

const signal = () => new AbortController().signal;

describe('the merchant panel API', () => {
  it('opens a demo session and reads it back; no session reads as null (F-J9-01)', async () => {
    const open = api(() => ({ status: 200, body: { signedIn: true, merchant: MERCHANT } }));
    expect(await open.merchant.signIn(MERCHANT.id, MERCHANT_TEST_TOKEN)).toEqual(MERCHANT);
    expect(open.calls).toEqual([
      {
        path: '/api/merchant/session',
        method: 'POST',
        body: { merchantId: MERCHANT.id, token: MERCHANT_TEST_TOKEN },
      },
    ]);
    const none = api(() => ({ status: 200, body: { signedIn: false } }));
    expect(await none.merchant.session(signal())).toBeNull();
  });

  it('refuses an answer outside its contract instead of showing it', async () => {
    const wrong = api(() => ({ status: 200, body: { merchants: [{ ...MERCHANT, demo: false }] } }));
    const failure = await wrong.merchant.merchants(signal()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).failure).toEqual({
      kind: 'contract',
      path: '/api/merchant/merchants',
    });
  });

  it('moves a ticket, scans and refunds by POST, never sending an amount', async () => {
    const counter = api((call) => {
      if (call.path.endsWith('/status'))
        return { status: 200, body: { orderId: 'o 1', status: 'preparing' } };
      if (call.path.endsWith('/scan')) {
        return {
          status: 202,
          body: { orderId: 'o', code: 'T-1001', status: 'ready', message: 'Wait.' },
        };
      }
      return {
        status: 200,
        body: {
          ok: true,
          message: 'Refunded.',
          refunded: { amountMinor: 300, currency: 'USD' },
          pending: { amountMinor: 0, currency: 'USD' },
        },
      };
    });
    await counter.merchant.moveTicket('o 1', 'preparing');
    expect(await counter.merchant.scan('code')).toMatchObject({ status: 'ready' });
    expect((await counter.merchant.refund('o 1', [1])).refunded.amountMinor).toBe(300);
    expect(counter.calls).toEqual([
      { path: '/api/merchant/tickets/o%201/status', method: 'POST', body: { status: 'preparing' } },
      { path: '/api/merchant/scan', method: 'POST', body: { code: 'code' } },
      { path: '/api/merchant/orders/o%201/refunds', method: 'POST', body: { lines: [1] } },
    ]);
  });

  it('reads the payouts with the refunds still to deduct and each batch refunds', async () => {
    const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
    const batch = {
      id: 'b1',
      status: 'success',
      gross: usd(1500),
      fee: usd(75),
      net: usd(1425),
      refunds: usd(300),
      until: '2026-11-09T05:00:00.000Z',
      createdAt: '2026-11-09T05:01:00.000Z',
      detail: null,
    };
    const board = {
      receiver: 'demo@example.com',
      available: true,
      refundsToDeduct: usd(450),
      batches: [batch],
    };
    const read = api(() => ({ status: 200, body: board }));
    const payouts = await read.merchant.payouts(signal());
    expect(payouts.refundsToDeduct.amountMinor).toBe(450);
    expect(payouts.batches[0]?.refunds.amountMinor).toBe(300);
    const old = api(() => ({ status: 200, body: { ...board, refundsToDeduct: undefined } }));
    const failure = await old.merchant.payouts(signal()).catch((error: unknown) => error);
    expect((failure as ApiRequestError).failure.kind).toBe('contract');
  });

  it('reads a refund still pending in PayPal (202) with its amount apart', async () => {
    const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });
    const refund = api(() => ({
      status: 202,
      body: { ok: true, message: 'PayPal is confirming.', refunded: usd(0), pending: usd(450) },
    }));
    expect(await refund.merchant.refund('o', [0])).toMatchObject({
      pending: usd(450),
      refunded: usd(0),
    });
  });

  it('saves the rules and asks to change the payout account with PUT (F-J9-07, F-J9-08)', async () => {
    const rules = {
      maxDiscountPercent: 20,
      minMarginPercent: 60,
      ordersPerQuarterHour: 4,
      prepMinutes: 15,
      featuredItemIds: [],
    };
    const day = [{ opens: '11:30', closes: '23:00' }];
    const hours = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] };
    const desk = api((call) =>
      call.path.endsWith('/agent')
        ? { status: 200, body: { rules, hours, version: 3 } }
        : {
            status: 403,
            body: {
              error: {
                code: 'forbidden',
                message: 'A demo merchant cannot change where its payouts go.',
                requestId: 'r1',
              },
            },
          },
    );
    expect(await desk.merchant.saveAgent(rules, hours, 2)).toEqual({ rules, hours, version: 3 });
    const refused = await desk.merchant
      .changePayoutAccount('demo@example.com')
      .catch((error: unknown) => error);
    expect((refused as ApiRequestError).failure).toMatchObject({ kind: 'http', status: 403 });
    expect(desk.calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      'PUT /api/merchant/agent',
      'PUT /api/merchant/payout-account',
    ]);
    expect(desk.calls[0]?.body).toEqual({ rules, hours, version: 2 });
  });
});
