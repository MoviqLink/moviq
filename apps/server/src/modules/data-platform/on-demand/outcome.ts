import { toInstant, type Provenance } from '@moviq/contracts';
import type { z } from 'zod';

import { HttpError, type HttpFailure } from '../../../infrastructure/http/client.js';
import type { ProviderOutcome } from '../../journeys/ports.js';
import { decodeJson, describeIssue } from '../sources/city/parsing.js';

/** The failing side of a provider outcome. */
type ProviderFailure = Extract<ProviderOutcome<unknown>, { readonly ok: false }>;

export function failure(
  state: ProviderFailure['state'],
  code: string,
  detail: string,
): ProviderFailure {
  return { ok: false, state, code, detail };
}

/**
 * What a failed request means, in one sentence for operators. Only `HttpError` is a request
 * failure; anything else is a programming error and is thrown again.
 */
export function failureFromHttp(error: unknown, provider: string): ProviderFailure {
  if (!(error instanceof HttpError)) throw error;
  return describeHttpFailure(error.failure, provider);
}

function describeHttpFailure(cause: HttpFailure, provider: string): ProviderFailure {
  switch (cause.kind) {
    case 'timeout':
      return failure(
        'unavailable',
        'timeout',
        `${provider} did not answer within ${String(cause.timeoutMs)} ms.`,
      );
    case 'aborted':
      return failure('unavailable', 'cancelled', `The request to ${provider} was cancelled.`);
    case 'network':
      return failure(
        'unavailable',
        'network',
        `${provider} could not be reached (${cause.detail}).`,
      );
    case 'too_large':
      return failure(
        'unavailable',
        'too-large',
        `${provider} sent more than ${String(cause.maxBytes)} bytes.`,
      );
    case 'status':
      return statusFailure(cause.status, cause.retryAfterMs, provider);
  }
}

function statusFailure(
  status: number,
  retryAfterMs: number | undefined,
  provider: string,
): ProviderFailure {
  const http = `HTTP ${String(status)}`;
  if (status === 429) {
    const wait =
      retryAfterMs === undefined ? '' : `, for ${String(Math.ceil(retryAfterMs / 1000))} s`;
    return failure(
      'rate_limited',
      'rate-limited',
      `${provider} asked to slow down (${http}${wait}).`,
    );
  }
  if (status === 401 || status === 403) {
    return failure(
      'misconfigured',
      'access-refused',
      `${provider} refused access (${http}): check the credential.`,
    );
  }
  if (status >= 500) {
    return failure('unavailable', 'provider-error', `${provider} failed to answer (${http}).`);
  }
  return failure(
    'misconfigured',
    'request-refused',
    `${provider} refused the request (${http}): its contract may have changed.`,
  );
}

/** The body as JSON, or why it is not: an HTML error page or a cut answer. */
export function readJson(
  body: Uint8Array,
  provider: string,
): { readonly ok: true; readonly value: unknown } | ProviderFailure {
  const decoded = decodeJson(body);
  if (decoded.ok) return decoded;
  return failure(
    'unavailable',
    'not-json',
    `${provider} did not answer in JSON. ${decoded.detail}`,
  );
}

/** A body that is JSON but not in the provider's documented format. */
export function unexpectedShape(error: z.ZodError, provider: string): ProviderFailure {
  return failure(
    'misconfigured',
    'unexpected-shape',
    `${provider} answered in an unexpected format (${describeIssue(error)}).`,
  );
}

/** The time a provider sent its answer, from its `Date` header. */
export function responseTime(headers: Headers): Date | null {
  const value = headers.get('date');
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export function providerProvenance(input: {
  readonly sourceId: string;
  readonly dataTime: Date | null;
  readonly receivedAt: Date;
  readonly evidence: string;
}): Provenance {
  const { dataTime, receivedAt } = input;
  return {
    sourceId: input.sourceId,
    dataTime: dataTime === null ? null : toInstant(dataTime),
    receivedAt: toInstant(receivedAt),
    ageSeconds:
      dataTime === null
        ? null
        : Math.max(0, Math.round((receivedAt.getTime() - dataTime.getTime()) / 1000)),
    state: 'healthy',
    evidence: input.evidence,
  };
}
