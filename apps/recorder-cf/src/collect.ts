import { HttpError, type HttpClient } from '../../server/src/infrastructure/http/client.js';
import type { RecordedSource } from './sources.js';
import type { SourceState } from './state.js';

export type Download =
  | { readonly kind: 'body'; readonly body: Uint8Array; readonly etag: string | undefined }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'failed'; readonly why: string; readonly retryAfterMs: number | undefined };

/** After this many failures in a row a source waits longer each time, up to five minutes. */
const FAILURES_BEFORE_BACKOFF = 3;
const MAX_BACKOFF_MS = 5 * 60_000;
const JITTER = 0.2;

/** Hides query values that could hold a key, and keeps messages short. */
export function masked(text: string): string {
  return text
    .replace(/([?&][^=&\s]*(?:key|token|secret)[^=&\s]*=)[^&\s]*/gi, '$1***')
    .slice(0, 300);
}

/**
 * Downloads one source with the common client: the generic browser identity, the limits of the
 * source and its ETag, so an unchanged answer costs a 304 and nothing is stored twice.
 */
export async function download(
  http: HttpClient,
  source: RecordedSource,
  state: SourceState,
  now: Date,
): Promise<Download> {
  const { definition } = source;
  const request = definition.request({ credentials: {}, now });
  try {
    const response = await http.get({
      url: request.url,
      headers: request.headers,
      timeoutMs: definition.limits.timeoutMs,
      maxBytes: definition.limits.maxBytes,
      ifNoneMatch: state.etag ?? undefined,
    });
    if (response.notModified) return { kind: 'unchanged' };
    return { kind: 'body', body: response.body, etag: response.etag };
  } catch (error) {
    if (!(error instanceof HttpError))
      return {
        kind: 'failed',
        why: 'The request failed in an unexpected way.',
        retryAfterMs: undefined,
      };
    const retryAfterMs = error.failure.kind === 'status' ? error.failure.retryAfterMs : undefined;
    return { kind: 'failed', why: masked(error.message), retryAfterMs };
  }
}

/**
 * When a source is due again: at its cadence while it answers; after three failures in a row,
 * twice as long each time up to five minutes, ± 20 % at random so sources that fell together do
 * not return together, and never sooner than its cadence or a `Retry-After`.
 */
export function nextAttempt(
  source: RecordedSource,
  failures: number,
  nowMs: number,
  retryAfterMs: number | undefined,
  random: () => number,
): number {
  if (failures < FAILURES_BEFORE_BACKOFF && retryAfterMs === undefined)
    return nowMs + source.everyMs;
  const doubled = source.everyMs * 2 ** Math.max(0, failures - FAILURES_BEFORE_BACKOFF + 1);
  const wait = Math.max(source.everyMs, Math.min(MAX_BACKOFF_MS, doubled), retryAfterMs ?? 0);
  const jittered = Math.round(wait * (1 + JITTER * (2 * random() - 1)));
  return nowMs + Math.max(source.everyMs, retryAfterMs ?? 0, jittered);
}
