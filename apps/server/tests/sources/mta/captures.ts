import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  ParseResult,
  SourceDefinition,
} from '../../../src/modules/data-platform/definition.js';
import { mtaSources } from '../../../src/modules/data-platform/sources/mta/index.js';

const FIXTURES = new URL('../../../../../tests/fixtures/mta/', import.meta.url);

/** The moment the live captures were taken (New York: 10/11/2026, 20:07). */
export const CAPTURED_AT = new Date('2026-11-11T01:07:00.000Z');

export function capture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(name, FIXTURES))));
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function source(id: string): SourceDefinition {
  const found = mtaSources.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no MTA source ${id}`);
  return found;
}

/** Parses with nothing served yet, at the capture time unless another is given. */
export function parseFresh(
  id: string,
  body: Uint8Array,
  receivedAt = CAPTURED_AT,
): ParseResult<unknown> {
  return source(id).parse(body, { receivedAt, previous: undefined });
}

/** The accepted result, or a failed test that shows the refusal. */
export function accepted(
  result: ParseResult<unknown>,
): Extract<ParseResult<unknown>, { ok: true }> {
  if (!result.ok) throw new Error(`refused ${result.code}: ${result.detail}`);
  return result;
}

/** Data as the platform stores it and reads it back. */
export function storedAndRead(id: string, data: unknown): unknown {
  return source(id).dataSchema.parse(JSON.parse(JSON.stringify(data)));
}
