import type { z } from 'zod';

import type { KnownFailure } from '../../definition.js';

interface Refusal {
  readonly ok: false;
  readonly code: 'not-json' | 'unexpected-shape';
  readonly detail: string;
}

/** A JSON list whose every row matches `row`, or why the body is not one. */
export function readJsonList<S extends z.ZodType>(
  body: Uint8Array,
  list: S,
): { readonly ok: true; readonly rows: z.output<S> } | Refusal {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'not-json', detail };
  }
  const parsed = list.safeParse(json);
  if (parsed.success) return { ok: true, rows: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    code: 'unexpected-shape',
    detail: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
  };
}

/** Failures of a JSON list read once a day, after the HTTP ones of its provider. */
export function listFailures(
  http: readonly KnownFailure[],
  minimum: string,
): readonly KnownFailure[] {
  return [
    ...http,
    {
      code: 'not-json',
      detection: 'The body is not JSON, as with an HTML error page',
      state: 'degraded',
      remedy: 'The served list stays; the next daily run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'The JSON is not a list of rows with the published fields and codes',
      state: 'misconfigured',
      remedy: 'An operator compares the list with the documentation of the dataset',
    },
    {
      code: 'check-failed',
      detection: `${minimum}, or an id listed twice`,
      state: 'degraded',
      remedy: 'Refused, so a cut list never reads as the whole network',
    },
  ];
}
