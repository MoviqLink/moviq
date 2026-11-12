import type { IncomingMessage } from 'node:http';
import { buffer } from 'node:stream/consumers';

/** An answer of the real service, as the stand-in passes it on. */
export interface Relayed {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/**
 * Headers of one connection, not of the message: the stand-in and the service each set their
 * own. The body arrives decoded, so its encoding and length are not passed on either.
 */
const CONNECTION_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'accept-encoding',
]);

/** Longer than any request the API makes, so the API's own time-out decides. */
const RELAY_TIMEOUT_MS = 30_000;

function forwardedHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || CONNECTION_HEADERS.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  return headers;
}

/**
 * Sends a request that reached the stand-in as `/<host>/<path>?<query>` on to that host over
 * HTTPS, with its method, headers and body, and returns the answer as it came. Nothing of either
 * is logged or kept: PayPal's requests carry the server's credentials.
 */
export async function relay(request: IncomingMessage, target: URL): Promise<Relayed> {
  const method = request.method ?? 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await buffer(request);
  const answer = await fetch(target, {
    method,
    headers: forwardedHeaders(request),
    redirect: 'manual',
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    ...(body === undefined ? {} : { body }),
  });
  const headers = Object.fromEntries(
    [...answer.headers].filter(([name]) => !CONNECTION_HEADERS.has(name)),
  );
  return { status: answer.status, headers, body: new Uint8Array(await answer.arrayBuffer()) };
}
