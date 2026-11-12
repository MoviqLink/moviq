import { HttpError, type HttpClient } from '../../infrastructure/http/client.js';
import type { SourceDefinition } from './definition.js';
import type { HealthRecord } from './health-store.js';
import { encodeSnapshot, type EncodedSnapshot } from './snapshots.js';

/** What one collection attempt found, before anything is written. */
export type Attempt =
  | {
      readonly outcome: 'admitted';
      readonly snapshot: EncodedSnapshot;
      readonly data: unknown;
      readonly dataTime: Date;
      readonly coverage: string;
      readonly response: ResponseFacts;
    }
  | {
      readonly outcome: 'unchanged';
      readonly dataTime: Date | undefined;
      readonly coverage: string | undefined;
      readonly response: ResponseFacts;
    }
  | {
      readonly outcome: 'rejected' | 'failed' | 'rate_limited' | 'misconfigured';
      readonly errorCode: string;
      readonly detail: string;
      readonly retryAfterMs?: number | undefined;
      readonly response: ResponseFacts | undefined;
    };

interface ResponseFacts {
  readonly httpStatus: number;
  readonly bytes: number;
  readonly latencyMs: number;
  readonly etag: string | undefined;
}

export interface AttemptInput {
  readonly definition: SourceDefinition;
  readonly current: HealthRecord | undefined;
  readonly forceFull?: boolean;
  /** The data served now, already validated, or undefined if there is none. */
  readonly previous: unknown;
  readonly credentials: Readonly<Record<string, string>>;
  readonly http: HttpClient;
  readonly now: () => Date;
}

/** Data dated more than this ahead of our clock is refused as impossible. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

/**
 * Downloads, validates, normalises and checks one source. A bad candidate never replaces the
 * served data: it comes back as `rejected` with the reason.
 */
export async function attemptCollection(input: AttemptInput): Promise<Attempt> {
  const { definition, current } = input;
  const request = definition.request({ credentials: input.credentials, now: input.now() });
  let response;
  try {
    response = await input.http.get({
      url: request.url,
      headers: request.headers,
      timeoutMs: definition.limits.timeoutMs,
      maxBytes: definition.limits.maxBytes,
      ifNoneMatch:
        input.forceFull || current?.servedVersion === undefined ? undefined : current.etag,
    });
  } catch (error) {
    return classifyFailure(error);
  }
  const facts: ResponseFacts = {
    httpStatus: response.status,
    bytes: response.body.byteLength,
    latencyMs: response.durationMs,
    etag: response.etag,
  };
  if (response.notModified) {
    return {
      outcome: 'unchanged',
      dataTime: current?.dataTime,
      coverage: current?.coverage,
      response: facts,
    };
  }
  return admitOrReject(input, response.body, facts);
}

function admitOrReject(input: AttemptInput, body: Uint8Array, response: ResponseFacts): Attempt {
  const { definition, current } = input;
  const receivedAt = input.now();
  const reject = (errorCode: string, detail: string): Attempt => ({
    outcome: 'rejected',
    errorCode,
    detail,
    response,
  });
  const parsed = definition.parse(body, { receivedAt, previous: input.previous });
  if (!parsed.ok) return reject(parsed.code, parsed.detail);
  const valid = definition.dataSchema.safeParse(parsed.data);
  if (!valid.success) {
    const shown = valid.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`);
    return reject('schema-mismatch', `The data breaks its schema: ${shown.join('; ')}.`);
  }
  const data: unknown = valid.data;
  const issues = definition.check?.(data, input.previous) ?? [];
  if (issues.length > 0) return reject('check-failed', issues.join('; '));
  if (Number.isNaN(parsed.dataTime.getTime()))
    return reject('invalid-data-time', 'The data carries no valid time.');
  if (parsed.dataTime.getTime() - receivedAt.getTime() > FUTURE_TOLERANCE_MS) {
    return reject(
      'future-data-time',
      `The data is dated ${parsed.dataTime.toISOString()}, ahead of our clock.`,
    );
  }
  if (current?.dataTime !== undefined && parsed.dataTime < current.dataTime) {
    return reject(
      'older-than-served',
      `The data is dated ${parsed.dataTime.toISOString()}, before the copy served.`,
    );
  }
  const snapshot = encodeSnapshot(data);
  if (snapshot.version === current?.servedVersion) {
    return { outcome: 'unchanged', dataTime: parsed.dataTime, coverage: parsed.coverage, response };
  }
  return {
    outcome: 'admitted',
    snapshot,
    data,
    dataTime: parsed.dataTime,
    coverage: parsed.coverage,
    response,
  };
}

/** Credential and contract errors are `misconfigured` (no retry loop); 429 is `rate_limited`. */
function classifyFailure(error: unknown): Attempt {
  if (!(error instanceof HttpError)) {
    return {
      outcome: 'failed',
      errorCode: 'unexpected',
      detail: 'The request failed in an unexpected way; the details are in the worker log.',
      response: undefined,
    };
  }
  const { failure } = error;
  switch (failure.kind) {
    case 'status': {
      const code = `http-${String(failure.status)}`;
      if (failure.status === 401 || failure.status === 403) {
        return {
          outcome: 'misconfigured',
          errorCode: code,
          detail: error.message,
          response: undefined,
        };
      }
      if (failure.status === 429) {
        return {
          outcome: 'rate_limited',
          errorCode: code,
          detail: error.message,
          retryAfterMs: failure.retryAfterMs,
          response: undefined,
        };
      }
      return { outcome: 'failed', errorCode: code, detail: error.message, response: undefined };
    }
    case 'timeout':
      return {
        outcome: 'failed',
        errorCode: 'timeout',
        detail: error.message,
        response: undefined,
      };
    case 'too_large':
      return {
        outcome: 'rejected',
        errorCode: 'too-large',
        detail: error.message,
        response: undefined,
      };
    case 'aborted':
      return {
        outcome: 'failed',
        errorCode: 'aborted',
        detail: error.message,
        response: undefined,
      };
    case 'network':
      return {
        outcome: 'failed',
        errorCode: 'network',
        detail: error.message,
        response: undefined,
      };
  }
}
