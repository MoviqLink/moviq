import { describe, expect, it, vi } from 'vitest';

import { createOpsApi } from '../src/features/ops/api';
import { createApiClient } from '../src/shared/api/client';
import { ApiRequestError } from '../src/shared/api/errors';
import { opsFixtures } from './fixtures/ops';

const NOW = Date.parse('2026-11-11T14:00:00.000Z');
const fixtures = opsFixtures(NOW);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const unauthorized = { error: { code: 'unauthorized', message: 'No session.', requestId: 'r1' } };

describe('control room API', () => {
  it('reads a missing session as signed out, not as a failure', async () => {
    const ops = createOpsApi(createApiClient(() => Promise.resolve(json(401, unauthorized))));
    await expect(ops.session(new AbortController().signal)).resolves.toBeNull();
  });

  it('still reports a session check that cannot reach the API', async () => {
    const ops = createOpsApi(createApiClient(() => Promise.reject(new TypeError('offline'))));
    await expect(ops.session(new AbortController().signal)).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('asks for a refresh of the encoded source with its reason and validates the job', async () => {
    const job = fixtures.jobs.jobs[0];
    const fetch = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(202, job)),
    );
    const ops = createOpsApi(createApiClient(fetch));
    await expect(ops.refresh('mta/alerts', 'Stale after timeouts')).resolves.toEqual(job);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/ops/sources/mta%2Falerts/refresh');
    expect(fetch.mock.calls[0]?.[1].body).toBe('{"reason":"Stale after timeouts"}');
  });

  it('validates every list it reads', async () => {
    const ops = createOpsApi(createApiClient(() => Promise.resolve(json(200, fixtures.sources))));
    const list = await ops.sources(new AbortController().signal);
    expect(list.sources).toHaveLength(fixtures.sources.sources.length);
    const broken = createOpsApi(createApiClient(() => Promise.resolve(json(200, { sources: 3 }))));
    await expect(broken.sources(new AbortController().signal)).rejects.toMatchObject({
      failure: { kind: 'contract' },
    });
  });
});
