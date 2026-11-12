import { describe, expect, it } from 'vitest';

import { createTicketsApi } from '../src/features/tickets/api';
import { createApiClient } from '../src/shared/api/client';
import { ApiRequestError } from '../src/shared/api/errors';

const product = {
  id: 'path-tapp-40-demo',
  category: 'train',
  name: 'PATH TAPP 40 rides',
  operator: 'PATH',
  description: 'Published PATH fare.',
  price: { amountMinor: 12400, currency: 'USD' },
  rides: 40,
  officialUrl: 'https://www.panynj.gov/path/en/fares.html',
  fareVerifiedAt: '2026-11-11',
};
const catalog = {
  demo: true,
  notice: 'Demo only. No trip is provided.',
  products: [product],
  information: [],
};
const wallet = { demo: true, hasMore: false, notice: catalog.notice, items: [] };

function setup() {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const api = createTicketsApi(
    createApiClient((path, init) => {
      calls.push({
        path,
        method: init.method ?? 'GET',
        body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const response = path.endsWith('/catalog')
        ? catalog
        : path.endsWith('/intents')
          ? {
              id: '550e8400-e29b-41d4-a716-446655440000',
              product,
              purpose: { kind: 'ticket-product', intentId: '550e8400-e29b-41d4-a716-446655440000' },
            }
          : path.endsWith('/wallet')
            ? wallet
            : {};
      return Promise.resolve(
        new Response(JSON.stringify(response), { status: path.endsWith('/intents') ? 201 : 200 }),
      );
    }),
  );
  return { api, calls };
}

describe('ticket API', () => {
  it('validates catalog, creates only an id-based intent, then reads the wallet', async () => {
    const { api, calls } = setup();
    expect((await api.catalog(new AbortController().signal)).products[0]?.price.amountMinor).toBe(
      12400,
    );
    const intent = await api.intent(product.id);
    expect(intent.purpose).toEqual({ kind: 'ticket-product', intentId: intent.id });
    expect(await api.wallet(new AbortController().signal)).toMatchObject({
      hasMore: false,
      items: [],
    });
    expect(calls).toEqual([
      { path: '/api/tickets/catalog', method: 'GET', body: undefined },
      { path: '/api/tickets/intents', method: 'POST', body: { productId: product.id } },
      { path: '/api/tickets/wallet', method: 'GET', body: undefined },
    ]);
  });

  it('refuses malformed server answers rather than displaying fares without their source date', async () => {
    const api = createTicketsApi(
      createApiClient(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ ...catalog, products: [{ ...product, fareVerifiedAt: undefined }] }),
            { status: 200 },
          ),
        ),
      ),
    );
    const error = await api.catalog().catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).failure).toEqual({
      kind: 'contract',
      path: '/api/tickets/catalog',
    });
  });
});
