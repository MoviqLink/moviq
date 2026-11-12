import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Place } from '@moviq/contracts';

import type { Clock } from '../../src/infrastructure/clock/clock.js';
import { createHttpClient, type HttpClient } from '../../src/infrastructure/http/client.js';
import type { RouteQuery } from '../../src/modules/journeys/ports.js';

/** A capture of `tests/fixtures/on-demand/`, as text. */
export function capture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../tests/fixtures/on-demand/${name}`, import.meta.url)),
    'utf8',
  );
}

export interface StubAnswer {
  readonly status?: number;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface SentRequest {
  readonly url: string;
  readonly headers: Headers;
}

/**
 * The shared HTTP client over a stub `fetch` that answers `answer` (or fails like a refused
 * connection when it is `'network-down'`), keeping each request it was sent.
 */
export function stubHttp(answer: StubAnswer | 'network-down'): {
  readonly http: HttpClient;
  readonly sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fetchStub: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    sent.push({ url, headers: new Headers(init?.headers) });
    if (answer === 'network-down') {
      return Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }));
    }
    const status = answer.status ?? 200;
    const body = status === 204 ? null : (answer.body ?? '');
    return Promise.resolve(new Response(body, { status, headers: answer.headers ?? {} }));
  };
  return { http: createHttpClient({ fetch: fetchStub }), sent };
}

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export const redHook: Place = {
  label: 'Red Hook',
  lat: 40.6764,
  lon: -74.011,
  kind: 'address',
  stopId: null,
};

export const timesSquare: Place = {
  label: 'Times Square',
  lat: 40.758,
  lon: -73.9855,
  kind: 'address',
  stopId: null,
};

/** The question behind `transitous-plan.json`: by 22:30 in New York, walking 15 minutes at most. */
export const capturedQuery: RouteQuery = {
  from: redHook,
  to: timesSquare,
  arriveBy: new Date('2026-11-11T03:30:00Z'),
  modes: ['walk', 'subway', 'bus'],
  maxWalkMinutes: 15,
  stepFree: false,
  count: 3,
};

/** The headers Transitous sent with the capture. */
export const transitousHeaders = {
  'content-type': 'application/json',
  date: 'Wed, 11 Nov 2026 01:55:13 GMT',
  server: 'MOTIS v2.11.4',
} as const;
