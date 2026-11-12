import { ApiRequestError, httpFailure } from './errors';

/** Anything that validates an unknown value, as every schema in `@moviq/contracts` does. */
interface Schema<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  /**
   * Error statuses whose body is an expected answer rather than a failure (a refused scan at the
   * counter, say): it is validated by the schema like a 2xx body.
   */
  readonly answers?: readonly number[];
  readonly signal?: AbortSignal;
  /** Milliseconds before the request counts as unanswered; `TIMEOUT_MS` when not given. */
  readonly timeoutMs?: number;
}

export interface ApiClient {
  /** A request whose 2xx body must match `schema`; the value returned is the validated one. */
  json<T>(path: string, schema: Schema<T>, options?: RequestOptions): Promise<T>;
  /** A request answered with no body (204); any 2xx counts as done. */
  send(path: string, options?: RequestOptions): Promise<void>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

/**
 * The limit for a request that waits on Sara's AI model: the server gives each model step up to
 * 30 seconds and a turn may take a few, so 10 seconds would cut answers that are on their way.
 */
export const MODEL_TIMEOUT_MS = 60_000;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The single way the web talks to the API: same origin with the session cookie, no HTTP cache,
 * a time limit, every body validated, and one error type for every way a request can fail.
 */
export function createApiClient(fetchImpl: Fetch, baseUrl = ''): ApiClient {
  async function call(path: string, options: RequestOptions): Promise<unknown> {
    const signals = [AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS)];
    if (options.signal) signals.push(options.signal);
    const init: RequestInit = {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.any(signals),
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
      init.headers = { accept: 'application/json', 'content-type': 'application/json' };
    }
    let body: unknown;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init);
      body = await readBody(response);
    } catch (error) {
      if (options.signal?.aborted === true || isAbort(error)) {
        throw new ApiRequestError({ kind: 'aborted' });
      }
      throw new ApiRequestError({ kind: 'network', timedOut: isTimeout(error) });
    }
    // An answer that arrives after its request was cancelled is never used.
    if (options.signal?.aborted === true) throw new ApiRequestError({ kind: 'aborted' });
    const answered = response.ok || (options.answers?.includes(response.status) ?? false);
    if (!answered) throw new ApiRequestError(httpFailure(response.status, body));
    return body;
  }

  return {
    async json<T>(path: string, schema: Schema<T>, options: RequestOptions = {}): Promise<T> {
      const parsed = schema.safeParse(await call(path, options));
      if (!parsed.success) throw new ApiRequestError({ kind: 'contract', path });
      return parsed.data;
    },
    async send(path: string, options: RequestOptions = {}): Promise<void> {
      await call(path, options);
    },
  };
}

/** The client the screens use: the browser's fetch against the page's own origin. */
export const api = createApiClient((input, init) => fetch(input, init));
