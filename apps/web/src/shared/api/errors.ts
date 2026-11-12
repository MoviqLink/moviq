import { apiErrorSchema, type ApiError } from '@moviq/contracts';

type ApiErrorCode = ApiError['error']['code'];

/**
 * Why a request did not give a usable answer:
 * - `network`: the API did not answer (offline, refused, timed out);
 * - `http`: the API answered with an error status, with its contract code when the body had one;
 * - `contract`: the API answered 2xx with a body that does not match its schema;
 * - `aborted`: a newer request or the screen itself cancelled this one.
 */
export type ApiFailure =
  | { readonly kind: 'network'; readonly timedOut: boolean }
  | {
      readonly kind: 'http';
      readonly status: number;
      readonly code: ApiErrorCode | null;
      readonly message: string | null;
      readonly requestId: string | null;
    }
  | { readonly kind: 'contract'; readonly path: string }
  | { readonly kind: 'aborted' };

/** The only error the API client throws, so callers switch on `failure.kind` and nothing else. */
export class ApiRequestError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(`API request failed: ${failure.kind}`);
    this.name = 'ApiRequestError';
    this.failure = failure;
  }

  /** The contract code of an HTTP error, or null for every other failure. */
  get code(): ApiErrorCode | null {
    return this.failure.kind === 'http' ? this.failure.code : null;
  }
}

/** Reads an error response. A body outside the contract still yields the status. */
export function httpFailure(status: number, body: unknown): ApiFailure {
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) return { kind: 'http', status, code: null, message: null, requestId: null };
  const { code, message, requestId } = parsed.data.error;
  return { kind: 'http', status, code, message, requestId };
}
