import { describe, expect, it } from 'vitest';

import { HttpError, type HttpFailure } from '../../src/infrastructure/http/client.js';
import { createDailyBudget } from '../../src/modules/data-platform/on-demand/daily-budget.js';
import {
  failureFromHttp,
  readJson,
  responseTime,
} from '../../src/modules/data-platform/on-demand/outcome.js';
import { decodePolyline } from '../../src/modules/data-platform/on-demand/polyline.js';
import { splitTransitousId } from '../../src/modules/data-platform/on-demand/transitous-ids.js';

describe('decodePolyline', () => {
  it('decodes the example of the encoding into [longitude, latitude] pairs', () => {
    // The worked example of Google's "Encoded Polyline Algorithm Format", at precision 5.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
    expect(decodePolyline('', 6)).toEqual([]);
  });

  it('refuses a polyline cut short or with characters outside the encoding', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq', 5)).toBeUndefined();
    expect(decodePolyline('_p~iF~ps|U', 5)).toHaveLength(1);
    expect(decodePolyline('_p~iF~ps|', 5)).toBeUndefined();
    expect(decodePolyline('_p~iF ~ps|U', 5)).toBeUndefined();
  });

  it('refuses a point off the globe', () => {
    // Latitude 80 and then 100 degrees at precision 5, longitude 0.
    expect(decodePolyline('__hgN?', 5)).toEqual([[0, 80]]);
    expect(decodePolyline('_gjaR?', 5)).toBeUndefined();
  });
});

describe('splitTransitousId', () => {
  it('splits the feed from the GTFS id, keeping underscores inside the GTFS id', () => {
    expect(splitTransitousId('us-ny-MTA-NYCSubway_A41N')).toEqual({
      feed: 'us-ny-MTA-NYCSubway',
      gtfsId: 'A41N',
    });
    expect(splitTransitousId('us-ny-MTA-BusBrooklyn_GA_D6_B57')).toEqual({
      feed: 'us-ny-MTA-BusBrooklyn',
      gtfsId: 'GA_D6_B57',
    });
    expect(splitTransitousId('A41N')).toBeUndefined();
  });
});

describe('createDailyBudget', () => {
  it('spends up to its limit in a UTC day and starts again the next day', () => {
    const budget = createDailyBudget(2);
    const evening = new Date('2026-11-11T23:59:00Z');
    expect([budget.take(evening), budget.take(evening), budget.take(evening)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(budget.take(new Date('2026-11-12T00:00:00Z'))).toBe(true);
  });
});

describe('failureFromHttp', () => {
  const status = (code: number, retryAfterMs?: number): HttpFailure => ({
    kind: 'status',
    status: code,
    retryAfterMs,
    body: '',
  });
  const cases: readonly (readonly [HttpFailure, string, string])[] = [
    [{ kind: 'timeout', timeoutMs: 20_000 }, 'unavailable', 'timeout'],
    [{ kind: 'aborted' }, 'unavailable', 'cancelled'],
    [{ kind: 'network', detail: 'ECONNREFUSED' }, 'unavailable', 'network'],
    [{ kind: 'too_large', maxBytes: 10 }, 'unavailable', 'too-large'],
    [status(429, 30_000), 'rate_limited', 'rate-limited'],
    [status(401), 'misconfigured', 'access-refused'],
    [status(403), 'misconfigured', 'access-refused'],
    [status(404), 'misconfigured', 'request-refused'],
    [status(500), 'unavailable', 'provider-error'],
  ];

  it.each(cases)('%j is %s with code %s', (cause, state, code) => {
    const outcome = failureFromHttp(new HttpError(cause, 'https://a.example/p?key=x'), 'Provider');
    expect(outcome).toMatchObject({ ok: false, state, code });
    expect(outcome.detail).not.toContain('key=x');
  });

  it('says how long the provider asked to wait', () => {
    const outcome = failureFromHttp(new HttpError(status(429, 30_000), 'https://a.example/'), 'P');
    expect(outcome.detail).toBe('P asked to slow down (HTTP 429, for 30 s).');
  });

  it('throws anything that is not a request failure again', () => {
    expect(() => failureFromHttp(new RangeError('bug'), 'Provider')).toThrow(RangeError);
  });
});

describe('readJson and responseTime', () => {
  it('refuses text that is not JSON or not UTF-8 as not-json', () => {
    expect(readJson(new TextEncoder().encode('{"a":1}'), 'P')).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(readJson(new TextEncoder().encode('<html>'), 'P')).toMatchObject({ code: 'not-json' });
    expect(readJson(new Uint8Array([0xff, 0xfe]), 'P')).toMatchObject({ code: 'not-json' });
  });

  it('reads the Date header, or nothing', () => {
    expect(responseTime(new Headers({ date: 'Wed, 11 Nov 2026 01:55:13 GMT' }))).toEqual(
      new Date('2026-11-11T01:55:13Z'),
    );
    expect(responseTime(new Headers({ date: 'yesterday' }))).toBeNull();
    expect(responseTime(new Headers())).toBeNull();
  });
});
