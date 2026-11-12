import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createHttpClient,
  GENERIC_USER_AGENT,
  HttpError,
  parseRetryAfter,
} from '../src/infrastructure/http/client.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let handler: Handler = (_, response) => response.end();
let base = '';

beforeEach(async () => {
  server = createServer((request, response) => {
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const client = createHttpClient();
const request = (path: string, extra: Partial<Parameters<typeof client.get>[0]> = {}) =>
  client.get({ url: `${base}${path}`, timeoutMs: 1_000, maxBytes: 1_000, ...extra });

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected an HttpError');
}

describe('createHttpClient', () => {
  it('sends the generic browser identity and returns the body and its ETag', async () => {
    let userAgent: string | undefined;
    handler = (incoming, response) => {
      userAgent = incoming.headers['user-agent'];
      response.writeHead(200, { etag: '"v1"' }).end('hello');
    };
    const response = await request('/data');
    expect(userAgent).toBe(GENERIC_USER_AGENT);
    expect(new TextDecoder().decode(response.body)).toBe('hello');
    expect(response).toMatchObject({ status: 200, notModified: false, etag: '"v1"' });
  });

  it('asks with the ETag held and reports an unchanged copy', async () => {
    handler = (incoming, response) => {
      if (incoming.headers['if-none-match'] === '"v1"') response.writeHead(304).end();
      else response.writeHead(200, { etag: '"v1"' }).end('fresh');
    };
    const response = await request('/data', { ifNoneMatch: '"v1"' });
    expect(response).toMatchObject({ status: 304, notModified: true });
    expect(response.body.byteLength).toBe(0);
  });

  it('fails with the status and Retry-After, naming the path but never the query', async () => {
    handler = (_, response) => response.writeHead(429, { 'retry-after': '30' }).end('slow down');
    const error = await failure(request('/feed?key=secret-value'));
    expect(error.failure).toEqual({
      kind: 'status',
      status: 429,
      retryAfterMs: 30_000,
      body: 'slow down',
    });
    expect(error.message).toBe(`HTTP 429 for ${new URL(base).host}/feed`);
  });

  it('stops reading beyond the size limit, declared or streamed', async () => {
    handler = (_, response) =>
      response.writeHead(200, { 'content-length': '5000' }).end('x'.repeat(5000));
    expect((await failure(request('/big'))).failure).toEqual({
      kind: 'too_large',
      maxBytes: 1_000,
    });
    handler = (_, response) => {
      response.writeHead(200);
      response.write('x'.repeat(800));
      response.end('x'.repeat(800));
    };
    expect((await failure(request('/stream'))).failure.kind).toBe('too_large');
  });

  it('gives up after its timeout, and can be cancelled', async () => {
    handler = () => undefined;
    expect((await failure(request('/slow', { timeoutMs: 50 }))).failure).toEqual({
      kind: 'timeout',
      timeoutMs: 50,
    });
    const controller = new AbortController();
    const pending = request('/slow', { signal: controller.signal });
    controller.abort();
    expect((await failure(pending)).failure).toEqual({ kind: 'aborted' });
  });

  it('reports a refused connection as a network error', async () => {
    const error = await failure(
      client.get({ url: 'http://127.0.0.1:1/x', timeoutMs: 1_000, maxBytes: 10 }),
    );
    expect(error.failure.kind).toBe('network');
  });
});

describe('send', () => {
  it('sends the method and body, and keeps the start of an error body for the caller', async () => {
    let received = '';
    handler = (incoming, response) => {
      let body = '';
      incoming.on('data', (chunk: Buffer) => (body += chunk.toString()));
      incoming.on('end', () => {
        received = `${incoming.method ?? ''} ${body}`;
        response
          .writeHead(422, { 'content-type': 'application/json' })
          .end('{"name":"UNPROCESSABLE_ENTITY"}');
      });
    };
    const error = await failure(
      client.send({
        url: `${base}/orders`,
        method: 'POST',
        body: '{"intent":"CAPTURE"}',
        timeoutMs: 1_000,
        maxBytes: 1_000,
      }),
    );
    expect(received).toBe('POST {"intent":"CAPTURE"}');
    expect(error.failure).toEqual({
      kind: 'status',
      status: 422,
      retryAfterMs: undefined,
      body: '{"name":"UNPROCESSABLE_ENTITY"}',
    });
  });
});

describe('redirectTo (tests only)', () => {
  it('sends a provider request to the local origin, keeping host, path and query', async () => {
    let seen = '';
    handler = (incoming, response) => {
      seen = incoming.url ?? '';
      response.end('ok');
    };
    const redirected = createHttpClient({ redirectTo: base });
    await redirected.get({
      url: 'https://api.example.org/feeds/a%2Fb?key=1',
      timeoutMs: 1_000,
      maxBytes: 100,
    });
    expect(seen).toBe('/api.example.org/feeds/a%2Fb?key=1');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter('Wed, 11 Nov 2026 12:01:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});
