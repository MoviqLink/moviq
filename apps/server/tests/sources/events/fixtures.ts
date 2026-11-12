import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { EventList } from '../../../src/modules/data-platform/sources/events/index.js';
import type { ParseResult } from '../../../src/modules/data-platform/definition.js';

/** A capture of `tests/fixtures/events/` as bytes. */
export function capture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../../../tests/fixtures/events/${name}`, import.meta.url)),
    ),
  );
}

export const text = (name: string): string => new TextDecoder().decode(capture(name));

export const bytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

/** When each capture was downloaded (UTC), as in the README of the captures. */
export const RECEIVED = {
  ticketmaster: new Date('2026-11-11T04:40:20Z'),
  parks: new Date('2026-11-11T04:51:04Z'),
  venues: new Date('2026-11-11T04:37:40Z'),
} as const;

/** The data of an admitted parse, or the refusal as an error. */
export function admitted(result: ParseResult<EventList>): EventList {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

/** The code of a refusal, or `admitted`. */
export const codeOf = (result: ParseResult<EventList>): string =>
  result.ok ? 'admitted' : result.code;
