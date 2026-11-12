import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  ParseResult,
  SourceDefinition,
} from '../../../src/modules/data-platform/definition.js';

const FIXTURES = new URL('../../../../../tests/fixtures/', import.meta.url);

/** A capture of `tests/fixtures/<folder>/`. */
export function capture(folder: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`${folder}/${name}`, FIXTURES))));
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function json(value: unknown): Uint8Array {
  return text(JSON.stringify(value));
}

/** A JSON capture as an unknown value, to build faults from. */
export function captureJson(folder: string, name: string): unknown {
  return JSON.parse(new TextDecoder().decode(capture(folder, name)));
}

export function findSource(sources: readonly SourceDefinition[], id: string): SourceDefinition {
  const found = sources.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no source ${id}`);
  return found;
}

/** The accepted result, or a failed test that shows the refusal. */
export function accepted(
  result: ParseResult<unknown>,
): Extract<ParseResult<unknown>, { ok: true }> {
  if (!result.ok) throw new Error(`refused ${result.code}: ${result.detail}`);
  return result;
}

/** Data as the platform stores it and reads it back. */
export function storedAndRead(definition: SourceDefinition, data: unknown): unknown {
  return definition.dataSchema.parse(JSON.parse(JSON.stringify(data)));
}
