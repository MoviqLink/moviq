import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ParseResult } from '../../../src/modules/data-platform/definition.js';

const FIXTURES = new URL('../../../../../tests/fixtures/', import.meta.url);

/** A capture of `tests/fixtures/<folder>/`, as bytes. */
export function capture(folder: string, name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`${folder}/${name}`, FIXTURES))));
}

export function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** A capture parsed as JSON, to build variants of it in a test. */
export function captureJson(folder: string, name: string): unknown {
  return JSON.parse(new TextDecoder().decode(capture(folder, name)));
}

/** The accepted result, or a failed test that shows the refusal. */
export function accepted<T>(result: ParseResult<T>): Extract<ParseResult<T>, { ok: true }> {
  if (!result.ok) throw new Error(`refused ${result.code}: ${result.detail}`);
  return result;
}

/** The `Date` of each 511NY answer, on 11/11/2026 (New York: 22:50 to 23:35 on 10/11). */
export const RECEIVED = {
  closures: new Date('2026-11-11T03:50:02Z'),
  incidents: new Date('2026-11-11T03:50:39Z'),
  construction: new Date('2026-11-11T03:50:46Z'),
  futureConstruction: new Date('2026-11-11T04:07:06Z'),
  specialEvents: new Date('2026-11-11T03:52:42Z'),
  transitEvents: new Date('2026-11-11T03:52:38Z'),
  weatherWarnings: new Date('2026-11-11T04:07:17Z'),
  roadConditions: new Date('2026-11-11T04:07:11Z'),
  messageSigns: new Date('2026-11-11T04:07:01Z'),
  cameras: new Date('2026-11-11T03:50:50Z'),
  crossingTimes: new Date('2026-11-11T04:35:07Z'),
} as const;
