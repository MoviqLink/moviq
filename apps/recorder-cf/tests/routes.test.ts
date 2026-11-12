import { describe, expect, it } from 'vitest';

import { auditRoute, authorised, sameKey, statsRoute } from '../src/routes.js';
import { memoryBucket } from './support.js';

const request = (authorization?: string) =>
  new Request('https://recorder.example/status', {
    headers: authorization === undefined ? {} : { authorization },
  });

describe('the private routes', () => {
  it('need the read key as a bearer token, and refuse every request without one configured', () => {
    expect(authorised(request('Bearer k-123'), 'k-123')).toBe(true);
    expect(authorised(request('Bearer k-124'), 'k-123')).toBe(false);
    expect(authorised(request('k-123'), 'k-123')).toBe(false);
    expect(authorised(request(), 'k-123')).toBe(false);
    expect(authorised(request('Bearer '), '')).toBe(false);
    expect(authorised(request('Bearer x'), undefined)).toBe(false);
    expect(sameKey('abc', 'abcd')).toBe(false);
  });

  it('serve the statistics as stored, and say when a day is not reduced yet', async () => {
    const bucket = memoryBucket();
    await bucket.put('stats/latest.json', '{"day":"2026-11-10"}');
    const latest = await statsRoute(bucket, 'latest');
    expect(latest.headers.get('cache-control')).toBe('private, no-store');
    expect(await latest.text()).toBe('{"day":"2026-11-10"}');
    expect((await statsRoute(bucket, '2026-11-09')).status).toBe(404);
    expect((await statsRoute(bucket, '../x')).status).toBe(404);
  });

  it('give the audit of a day, hour by hour, as text', async () => {
    const bucket = memoryBucket();
    await bucket.put('audit/2026-11-10/08.txt', 'mta-subway-g failed: HTTP 503\n');
    await bucket.put('audit/2026-11-10/07.txt', 'flushed 2026-11-10/06\n');
    const answer = await auditRoute(bucket, '2026-11-10');
    expect(await answer.text()).toBe(
      '# 2026-11-10/07.txt\nflushed 2026-11-10/06\n# 2026-11-10/08.txt\nmta-subway-g failed: HTTP 503\n',
    );
    expect((await auditRoute(bucket, '2026-11-11')).status).toBe(404);
  });
});
