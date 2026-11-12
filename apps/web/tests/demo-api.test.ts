import { describe, expect, it } from 'vitest';

import { createDemoApi } from '../src/features/demo/api';
import { createApiClient } from '../src/shared/api/client';
import { ApiRequestError } from '../src/shared/api/errors';

describe('demo profiles', () => {
  it('uses separate profile sessions and only the demo partner report', async () => {
    const calls: string[] = [];
    const api = createDemoApi(
      createApiClient((path, init) => {
        calls.push(`${init.method ?? 'GET'} ${path}`);
        const body = path.endsWith('/status') ? { enabled: true } : { demo: true };
        return Promise.resolve(new Response(JSON.stringify(body)));
      }),
    );
    const signal = new AbortController().signal;
    expect(await api.status(signal)).toEqual({ enabled: true });
    await api.login('traveller', signal);
    await api.login('partner', signal);
    await api.logout();
    expect(calls).toEqual([
      'GET /api/tickets/demo/status',
      'POST /api/tickets/demo/traveller',
      'POST /api/tickets/demo/partner',
      'POST /api/tickets/demo/logout',
    ]);
  });

  it('rejects a partner response without full, server-calculated totals', async () => {
    const api = createDemoApi(
      createApiClient(() =>
        Promise.resolve(
          new Response(JSON.stringify({ demo: true, notice: '', items: [], hasMore: false })),
        ),
      ),
    );
    const error: unknown = await api
      .partner(new AbortController().signal)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiRequestError);
  });
});
