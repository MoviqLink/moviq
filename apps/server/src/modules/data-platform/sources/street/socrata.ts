import { z } from 'zod';

import {
  fromNewYorkWallClockText,
  toNewYorkWallClockText,
} from '../../../../infrastructure/clock/new-york.js';
import type { KnownFailure, Licence } from '../../definition.js';
import { decodeJson, describeIssue, refuse, type Refusal } from '../city/parsing.js';
import { httpFailures } from '../regional/provider-failures.js';

/** NYC Open Data: the City's terms of use, linked from its open data pages. */
export function nycOpenDataLicence(attribution: string): Licence {
  return {
    name: 'NYC.gov terms of use (NYC Open Data)',
    url: 'https://www.nyc.gov/main/terms-of-use',
    attribution,
  };
}

export const NYC_OPEN_DATA = 'https://data.cityofnewyork.us/resource/';

/** The rows of a Socrata answer that validate, and how many did not. */
export interface Rows<T> {
  readonly rows: readonly T[];
  readonly leftOut: number;
}

/**
 * A Socrata JSON list, row by row: a row that does not validate is left out and counted, so one
 * odd row never hides the others. A body that is not a list is refused.
 */
export function readRows<S extends z.ZodType>(
  body: Uint8Array,
  row: S,
): Rows<z.output<S>> | Refusal {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const list = z.array(z.unknown()).safeParse(decoded.value);
  if (!list.success) return refuse('unexpected-shape', describeIssue(list.error));
  const rows: z.output<S>[] = [];
  for (const candidate of list.data) {
    const parsed = row.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
  }
  return { rows, leftOut: list.data.length - rows.length };
}

/** The New York calendar date of an instant, `YYYY-MM-DD`. */
export function newYorkDate(instant: Date): string {
  return toNewYorkWallClockText(instant).slice(0, 10);
}

/** The instants a New York date runs between: its midnight and the next one. */
export function newYorkDay(date: string): { readonly start: Date; readonly end: Date } {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = fromNewYorkWallClockText(`${date}T00:00:00`);
  const end = fromNewYorkWallClockText(`${next.toISOString().slice(0, 10)}T00:00:00`);
  if (start === undefined || end === undefined) throw new Error(`Not a date: ${date}`);
  return { start, end };
}

/** Socrata's zone-less `2026-11-26T00:00:00.000` as the date it names. */
export const socrataDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?$/)
  .transform((text) => text.slice(0, 10));

/** A Socrata `$where` for rows whose period covers a New York date. */
export function coversDate(start: string, end: string, date: string): string {
  return `${start}<='${date}T23:59:59' AND ${end}>='${date}T00:00:00'`;
}

/** The failures of a list read from a Socrata portal, with the minimum that refuses a cut one. */
export function socrataFailures(portal: string, minimum: string): readonly KnownFailure[] {
  return [
    ...httpFailures(portal, `https://${portal}`),
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page of the portal',
      state: 'degraded',
      remedy: 'The served list stays with its age; the next run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'The answer is not a list of rows',
      state: 'misconfigured',
      remedy: 'An operator compares the answer with the columns of the dataset',
    },
    {
      code: 'check-failed',
      detection: minimum,
      state: 'degraded',
      remedy: 'Refused, so a cut list never reads as the whole city',
    },
  ];
}
