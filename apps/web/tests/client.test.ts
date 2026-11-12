import { apiErrorSchema, opsSessionSchema } from '@moviq/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApiClient, MODEL_TIMEOUT_MS } from '../src/shared/api/client';
import { ApiRequestError, type ApiFailure } from '../src/shared/api/errors';
import { createLatest } from '../src/shared/api/latest';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = { role: 'admin', expiresAt: '2026-11-11T12:00:00.000Z' };

async function failureOf(promise: Promise<unknown>): Promise<ApiFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiRequestError) return error.failure;
    throw error;
  }
  throw new Error('the request did not fail');
}

describe('API client', () => {
  it('returns the body validated by its schema', async () => {
    const client = createApiClient(() => Promise.resolve(json(200, session)));
    await expect(client.json('/api/ops/session', opsSessionSchema)).resolves.toEqual(session);
  });

  it('refuses a 2xx body outside the contract instead of passing it on', async () => {
    const client = createApiClient(() => Promise.resolve(json(200, { role: 'root' })));
    expect(await failureOf(client.json('/api/ops/session', opsSessionSchema))).toEqual({
      kind: 'contract',
      path: '/api/ops/session',
    });
  });

  it('refuses a 2xx answer that is not JSON', async () => {
    const client = createApiClient(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect((await failureOf(client.json('/x', opsSessionSchema))).kind).toBe('contract');
  });

  it('translates an error body into its contract code and request id', async () => {
    const body = { error: { code: 'forbidden', message: 'Admins only.', requestId: 'req-42' } };
    const client = createApiClient(() => Promise.resolve(json(403, body)));
    expect(await failureOf(client.send('/api/ops/jobs/3/cancel'))).toEqual({
      kind: 'http',
      status: 403,
      code: 'forbidden',
      message: 'Admins only.',
      requestId: 'req-42',
    });
  });

  it('keeps the status when an error body is outside the contract', async () => {
    const client = createApiClient(() =>
      Promise.resolve(new Response('Bad gateway', { status: 502 })),
    );
    expect(await failureOf(client.send('/x'))).toEqual({
      kind: 'http',
      status: 502,
      code: null,
      message: null,
      requestId: null,
    });
  });

  it('reports a network failure and a time-out as the API not answering', async () => {
    const refused = createApiClient(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await failureOf(refused.send('/x'))).toEqual({ kind: 'network', timedOut: false });
    const slow = createApiClient(() =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    expect(await failureOf(slow.send('/x'))).toEqual({ kind: 'network', timedOut: true });
  });

  it('waits 10 seconds by default and longer only when the request says so', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const client = createApiClient(() => Promise.resolve(new Response(null, { status: 204 })));
    await client.send('/x');
    await client.send('/sara', { timeoutMs: MODEL_TIMEOUT_MS });
    expect(timeout.mock.calls).toEqual([[10_000], [60_000]]);
    timeout.mockRestore();
  });

  it('asks without HTTP cache, with the session cookie and a JSON body', async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    await createApiClient(fetch).send('/api/ops/session', { method: 'POST', body: { token: 't' } });
    const [input, init] = fetch.mock.calls[0] ?? [];
    expect(input).toBe('/api/ops/session');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      body: '{"token":"t"}',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('sends PUT with its JSON body, and validates the answer like any other', async () => {
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, session)),
    );
    const client = createApiClient(fetch);
    await expect(
      client.json('/api/ops/session', opsSessionSchema, { method: 'PUT', body: { role: 'admin' } }),
    ).resolves.toEqual(session);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PUT', body: '{"role":"admin"}' });
  });

  it('reads an expected error status as an answer, and any other as a failure', async () => {
    const body = { error: { code: 'conflict', message: 'Used.', requestId: 'r-1' } };
    const refused = createApiClient(() => Promise.resolve(json(409, body)));
    await expect(refused.json('/scan', apiErrorSchema, { answers: [409] })).resolves.toEqual(body);
    expect(
      await failureOf(refused.json('/scan', apiErrorSchema, { answers: [404] })),
    ).toMatchObject({ kind: 'http', status: 409, code: 'conflict' });
    const outside = createApiClient(() => Promise.resolve(json(409, { nope: true })));
    expect((await failureOf(outside.json('/scan', apiErrorSchema, { answers: [409] }))).kind).toBe(
      'contract',
    );
  });

  it('never returns an answer that arrives after its request was cancelled', async () => {
    const controller = new AbortController();
    const client = createApiClient(() => {
      controller.abort();
      return Promise.resolve(json(200, session));
    });
    const failure = await failureOf(
      client.json('/api/ops/session', opsSessionSchema, { signal: controller.signal }),
    );
    expect(failure).toEqual({ kind: 'aborted' });
  });

  it('keeps only the newest of two overlapping requests', async () => {
    const answers: ((response: Response) => void)[] = [];
    const client = createApiClient(
      (_input, init) =>
        new Promise((resolve, reject) => {
          answers.push(resolve);
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const latest = createLatest();
    const old = client.json('/a', opsSessionSchema, { signal: latest.next() });
    const fresh = client.json('/a', opsSessionSchema, { signal: latest.next() });
    answers[1]?.(json(200, { ...session, role: 'viewer' }));
    answers[0]?.(json(200, session));
    expect(await failureOf(old)).toEqual({ kind: 'aborted' });
    await expect(fresh).resolves.toMatchObject({ role: 'viewer' });
  });
});
