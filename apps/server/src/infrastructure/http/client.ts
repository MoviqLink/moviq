/**
 * The identity sent to every external service: a common desktop browser from public lists. It
 * never names the project, its people or the machine it runs on.
 */
export const GENERIC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/156.0.0.0 Safari/537.36';

/** Browser client hints match the generic identity; no runtime or host metadata is sent. */
export const GENERIC_BROWSER_HEADERS = {
  'user-agent': GENERIC_USER_AGENT,
  'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
} as const;

export type HttpFailure =
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'network'; readonly detail: string }
  | { readonly kind: 'too_large'; readonly maxBytes: number }
  | {
      readonly kind: 'status';
      readonly status: number;
      /** From `Retry-After`, when the provider sent one. */
      readonly retryAfterMs: number | undefined;
      /** The start of the error body (8 KB at most), for providers that explain errors in it. */
      readonly body: string;
    };

/** A failed request. Its message names the host and path only: query strings may hold keys. */
export class HttpError extends Error {
  readonly failure: HttpFailure;

  constructor(failure: HttpFailure, url: string) {
    super(`${describeFailure(failure)} for ${safeLocation(url)}`);
    this.name = 'HttpError';
    this.failure = failure;
  }
}

interface HttpRequest {
  readonly url: string;
  /** GET when omitted. */
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** A request body, already serialised (JSON or form text). */
  readonly body?: string | undefined;
  readonly timeoutMs: number;
  /** The response body is cut off, and the request fails, beyond this size. */
  readonly maxBytes: number;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** The ETag of the copy already held; a `304` then means it is still current. */
  readonly ifNoneMatch?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

interface HttpResponse {
  readonly status: number;
  readonly notModified: boolean;
  readonly body: Uint8Array;
  readonly etag: string | undefined;
  readonly headers: Headers;
  readonly durationMs: number;
}

export interface HttpClient {
  /** A GET; `method` and `body` in the request are ignored. */
  get(request: HttpRequest): Promise<HttpResponse>;
  /** Any method, with its body. */
  send(request: HttpRequest): Promise<HttpResponse>;
}

export interface HttpClientOptions {
  readonly fetch?: typeof fetch;
  readonly userAgent?: string;
  readonly now?: () => number;
  /**
   * Tests only: sends every request to this local origin instead, with the original host as the
   * first path segment (`https://a.example/b?c` → `<origin>/a.example/b?c`).
   */
  readonly redirectTo?: string | undefined;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const doFetch = options.fetch ?? fetch;
  const userAgent = options.userAgent ?? GENERIC_USER_AGENT;
  const now = options.now ?? Date.now;
  const target = (url: string) =>
    options.redirectTo === undefined ? url : redirect(url, options.redirectTo);
  const send = async (request: HttpRequest): Promise<HttpResponse> => {
    const started = performance.now();
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const signal =
      request.signal === undefined ? timeout : AbortSignal.any([timeout, request.signal]);
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(GENERIC_BROWSER_HEADERS)) headers.set(name, value);
    headers.set('user-agent', userAgent);
    if (request.ifNoneMatch !== undefined) headers.set('if-none-match', request.ifNoneMatch);
    try {
      const response = await doFetch(target(request.url), {
        method: request.method ?? 'GET',
        headers,
        signal,
        redirect: 'follow',
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      if (response.status === 304) {
        await response.body?.cancel();
        return result(response, new Uint8Array(), true, started);
      }
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), now());
        const body = await errorExcerpt(response);
        throw new HttpError(
          { kind: 'status', status: response.status, retryAfterMs, body },
          request.url,
        );
      }
      const body = await readLimited(response, request.maxBytes, request.url);
      return result(response, body, false, started);
    } catch (error) {
      throw toHttpError(error, request, timeout);
    }
  };
  return {
    get: (request) => send({ ...request, method: 'GET', body: undefined }),
    send,
  };
}

const ERROR_EXCERPT_BYTES = 8 * 1024;

async function errorExcerpt(response: Response): Promise<string> {
  try {
    const bytes = await readLimited(response, ERROR_EXCERPT_BYTES, response.url);
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function result(
  response: Response,
  body: Uint8Array,
  notModified: boolean,
  started: number,
): HttpResponse {
  return {
    status: response.status,
    notModified,
    body,
    etag: response.headers.get('etag') ?? undefined,
    headers: response.headers,
    durationMs: Math.round(performance.now() - started),
  };
}

async function readLimited(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new HttpError({ kind: 'too_large', maxBytes }, url);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk: { done: boolean; value?: unknown } = await reader.read();
    if (chunk.done) break;
    const value = chunk.value;
    if (!(value instanceof Uint8Array))
      throw new HttpError({ kind: 'network', detail: 'unexpected body chunk' }, url);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError({ kind: 'too_large', maxBytes }, url);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function toHttpError(error: unknown, request: HttpRequest, timeout: AbortSignal): HttpError {
  if (error instanceof HttpError) return error;
  if (timeout.aborted)
    return new HttpError({ kind: 'timeout', timeoutMs: request.timeoutMs }, request.url);
  if (request.signal?.aborted === true) return new HttpError({ kind: 'aborted' }, request.url);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new HttpError({ kind: 'network', detail }, request.url);
}

function redirect(url: string, origin: string): string {
  const parsed = new URL(url);
  return `${origin}/${parsed.host}${parsed.pathname}${parsed.search}`;
}

/** `Retry-After` in seconds or as an HTTP date, in milliseconds from now. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

function describeFailure(failure: HttpFailure): string {
  switch (failure.kind) {
    case 'timeout':
      return `No answer within ${String(failure.timeoutMs)} ms`;
    case 'aborted':
      return 'Request cancelled';
    case 'network':
      return `Network error (${failure.detail})`;
    case 'too_large':
      return `Response larger than ${String(failure.maxBytes)} bytes`;
    case 'status':
      return `HTTP ${String(failure.status)}`;
  }
}

function safeLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return 'an invalid URL';
  }
}
