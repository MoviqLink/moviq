import { afterEach, describe, expect, it, vi } from 'vitest';

import { tripApi } from '../src/features/trip/api';
import { ApiRequestError } from '../src/shared/api/errors';
import { applied, payment } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function answer(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    return Promise.resolve(json(status, body));
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the trip endpoints', () => {
  it('take a free alternative with an empty POST and return the journey already changed', async () => {
    const calls = answer(200, applied(now, 'en', 'trip-risk'));
    const journey = await tripApi.applyAlternative('trip-risk', 'alt-q70');
    expect(calls).toEqual([
      {
        url: '/api/journeys/trip-risk/alternatives/alt-q70/apply',
        method: 'POST',
        body: undefined,
      },
    ]);
    expect(journey.itinerary.id).toBe('alt-q70');
    expect(journey.alternatives).toEqual([]);
  });

  it('pass on a refusal with its contract code', async () => {
    answer(409, { error: { code: 'conflict', message: 'Not watched.', requestId: 'req-1' } });
    const refusal = await tripApi.applyAlternative('trip-risk', 'alt-q70').catch((e: unknown) => e);
    expect(refusal instanceof ApiRequestError && refusal.code).toBe('conflict');
  });

  it('ask for one payment by its id', async () => {
    const calls = answer(200, payment(now, 'captured'));
    await expect(tripApi.getOrder('pay-1')).resolves.toMatchObject({ status: 'captured' });
    expect(calls[0]).toMatchObject({ url: '/api/payments/orders/pay-1', method: 'GET' });
  });
});
