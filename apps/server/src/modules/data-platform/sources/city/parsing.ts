import type { z } from 'zod';

/** Why a candidate is refused, in the shape `parse` returns. */
export interface Refusal {
  readonly ok: false;
  readonly code: string;
  readonly detail: string;
}

export function refuse(code: string, detail: string): Refusal {
  return { ok: false, code, detail };
}

/** The body as UTF-8 text, or a refusal when it is not valid UTF-8. */
export function decodeText(
  body: Uint8Array,
): { readonly ok: true; readonly text: string } | Refusal {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    return refuse('not-text', 'The body is not valid UTF-8 text.');
  }
}

/** The body parsed as JSON into an unknown value, to be validated by a schema next. */
export function decodeJson(
  body: Uint8Array,
): { readonly ok: true; readonly value: unknown } | Refusal {
  const decoded = decodeText(body);
  if (!decoded.ok) return decoded;
  try {
    const value: unknown = JSON.parse(decoded.text);
    return { ok: true, value };
  } catch {
    return refuse('not-json', `The body is not JSON: it starts with "${preview(decoded.text)}".`);
  }
}

/** The first problem a schema found, with where it is, for the operators' panel. */
export function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'The data does not match the expected format.';
  const where = issue.path.length === 0 ? 'root' : issue.path.map(String).join('.');
  return `${where}: ${issue.message}`;
}

/** The first characters of a body, on one line, to show what came instead of the format. */
function preview(text: string): string {
  return text.slice(0, 60).replace(/\s+/g, ' ').trim();
}

/** A reason for `check` when the candidate is older than the data already served. */
export function olderThanServed(candidate: string, served: string | undefined): readonly string[] {
  if (served === undefined || Date.parse(candidate) >= Date.parse(served)) return [];
  return [`older-than-served: the candidate is from ${candidate}, the served data from ${served}`];
}
