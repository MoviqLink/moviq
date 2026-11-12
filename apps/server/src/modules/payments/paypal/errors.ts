import { HttpError } from '../../../infrastructure/http/client.js';
import { errorBodySchema } from './schemas.js';

/**
 * What a failed call says about the money:
 * - `refused`: PayPal answered and said no. Nothing changed; `issue` says why.
 * - `not_done`: PayPal turned the request away before acting on it (rate limit, credentials).
 *   Nothing changed; the same call can be tried later.
 * - `unknown`: no usable answer (time-out, network, server error, unreadable reply), or PayPal
 *   still working on the first request under the same PayPal-Request-Id (409
 *   `PREVIOUS_REQUEST_IN_PROGRESS`). PayPal may have acted; only reading the resource back can tell.
 */
export type PayPalOutcome = 'refused' | 'not_done' | 'unknown';

/** Issue codes MovIQ reacts to. PayPal documents them in the Orders v2 and Payments v2 errors. */
export type PayPalIssue =
  | 'ORDER_NOT_APPROVED'
  | 'PAYER_ACTION_REQUIRED'
  | 'INSTRUMENT_DECLINED'
  | 'ORDER_ALREADY_CAPTURED'
  | 'RESOURCE_NOT_FOUND';

export class PayPalError extends Error {
  readonly operation: string;
  readonly outcome: PayPalOutcome;
  readonly status: number | undefined;
  /** PayPal's error name, such as `UNPROCESSABLE_ENTITY` or `RESOURCE_NOT_FOUND`. */
  readonly errorName: string | undefined;
  /** The most specific code: the first detail's issue, else the error name. */
  readonly issue: string | undefined;
  /** PayPal's id for this failure, to quote when asking PayPal about it. */
  readonly debugId: string | undefined;

  constructor(
    operation: string,
    outcome: PayPalOutcome,
    detail: string,
    fields: {
      readonly status?: number | undefined;
      readonly errorName?: string | undefined;
      readonly issue?: string | undefined;
      readonly debugId?: string | undefined;
    } = {},
  ) {
    super(`PayPal ${operation}: ${detail}`);
    this.name = 'PayPalError';
    this.operation = operation;
    this.outcome = outcome;
    this.status = fields.status;
    this.errorName = fields.errorName;
    this.issue = fields.issue;
    this.debugId = fields.debugId;
  }

  /** True when PayPal refused the call with this issue. */
  is(issue: PayPalIssue): boolean {
    return this.outcome === 'refused' && this.issue === issue;
  }
}

/** Turns a failed request into a PayPalError that says whether the money may have moved. */
export function toPayPalError(operation: string, error: unknown): PayPalError {
  if (error instanceof PayPalError) return error;
  if (!(error instanceof HttpError)) {
    return new PayPalError(operation, 'unknown', error instanceof Error ? error.message : 'failed');
  }
  const failure = error.failure;
  if (failure.kind !== 'status') return new PayPalError(operation, 'unknown', error.message);
  const body = parseErrorBody(failure.body);
  const fields = {
    status: failure.status,
    errorName: body?.name ?? body?.error,
    issue: body?.details?.[0]?.issue ?? body?.name ?? body?.error,
    debugId: body?.debug_id,
  };
  const detail = `HTTP ${String(failure.status)} ${fields.issue ?? ''}`.trim();
  if (failure.status >= 500 || fields.issue === 'PREVIOUS_REQUEST_IN_PROGRESS') {
    return new PayPalError(operation, 'unknown', detail, fields);
  }
  if (failure.status === 401 || failure.status === 429) {
    return new PayPalError(operation, 'not_done', detail, fields);
  }
  return new PayPalError(operation, 'refused', detail, fields);
}

function parseErrorBody(text: string) {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
