import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import { decodeText, describeIssue, refuse, type Refusal } from './parsing.js';

/** Elements that may repeat, read as arrays even when only one is present. */
const REPEATED = new Set([
  'Delay_type',
  'Program',
  'Ground_Delay',
  'Delay',
  'Arrival_Departure',
  'Airport',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (tagName) => REPEATED.has(tagName),
});

const text = z.string().optional();

const groundStopSchema = z.object({ ARPT: z.string(), Reason: text, End_Time: text });
const groundDelaySchema = z.object({ ARPT: z.string(), Reason: text, Avg: text, Max: text });
const arrivalDepartureSchema = z.object({
  Type: z.enum(['Arrival', 'Departure']),
  Min: text,
  Max: text,
  Trend: text,
});
const generalDelaySchema = z.object({
  ARPT: z.string(),
  Reason: text,
  Arrival_Departure: z.array(arrivalDepartureSchema).default([]),
});
const closureSchema = z.object({ ARPT: z.string(), Reason: text, Start: text, Reopen: text });

/** The lists MovIQ reads; another list that names a New York airport refuses the candidate. */
export const KNOWN_LISTS = new Set([
  'Name',
  'Ground_Stop_List',
  'Ground_Delay_List',
  'Arrival_Departure_Delay_List',
  'Airport_Closure_List',
]);

const delayTypeSchema = z
  .object({
    Name: z.string(),
    Ground_Stop_List: z.object({ Program: z.array(groundStopSchema) }).optional(),
    Ground_Delay_List: z.object({ Ground_Delay: z.array(groundDelaySchema) }).optional(),
    Arrival_Departure_Delay_List: z.object({ Delay: z.array(generalDelaySchema) }).optional(),
    Airport_Closure_List: z.object({ Airport: z.array(closureSchema) }).optional(),
  })
  .catchall(z.unknown());

const documentSchema = z.object({
  AIRPORT_STATUS_INFORMATION: z.object({
    Update_Time: z.string(),
    Delay_type: z.array(delayTypeSchema).default([]),
  }),
});

export type NasDelayType = z.infer<typeof delayTypeSchema>;

export interface NasStatusDocument {
  readonly updateTime: string;
  readonly delayTypes: readonly NasDelayType[];
}

const TAG =
  /<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^<>]*?)?(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^<>]*>/g;

/**
 * Why a text is not well-formed at the level of its tags (a tag left open, closed out of order,
 * or other than one root), or undefined. The XML reader is lenient: without this, a cut-off
 * answer or an HTML page would read as a status with fewer programs.
 */
export function tagBalanceProblem(text: string): string | undefined {
  const open: string[] = [];
  let roots = 0;
  for (const [, closing, name, selfClosing] of text.matchAll(TAG)) {
    // Comments, declarations and processing instructions have no name and nest nothing.
    if (name === undefined) continue;
    if (closing === '/') {
      const expected = open.pop();
      if (expected !== name)
        return `</${name}> closes ${expected === undefined ? 'nothing' : `<${expected}>`}`;
      continue;
    }
    if (open.length === 0) roots += 1;
    if (selfClosing !== '/') open.push(name);
  }
  const unclosed = open.at(-1);
  if (unclosed !== undefined) return `<${unclosed}> is never closed`;
  return roots === 1 ? undefined : `${String(roots)} root elements`;
}

/** Reads the FAA NAS Status XML into its validated shape, or says why it cannot. */
export function readNasStatusXml(
  body: Uint8Array,
): { readonly ok: true; readonly document: NasStatusDocument } | Refusal {
  const decoded = decodeText(body);
  if (!decoded.ok) return decoded;
  const problem = tagBalanceProblem(decoded.text);
  if (problem !== undefined) {
    return refuse('not-xml', `The body is not well-formed XML: ${problem}.`);
  }
  const parsed = documentSchema.safeParse(parser.parse(decoded.text));
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const root = parsed.data.AIRPORT_STATUS_INFORMATION;
  return { ok: true, document: { updateTime: root.Update_Time, delayTypes: root.Delay_type } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const UPDATE_TIME =
  /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4}) GMT$/;

/** `Wed Nov 11 01:00:34 2026 GMT`, the form of `Update_Time`, as an instant. */
export function parseUpdateTime(value: string): Date | undefined {
  const match = UPDATE_TIME.exec(value.trim());
  if (match === null) return undefined;
  const [monthName = '', day = '', hour = '', minute = '', second = '', year = ''] = match.slice(1);
  const month = MONTHS.indexOf(monthName);
  if (month < 0) return undefined;
  const instant = new Date(
    Date.UTC(Number(year), month, Number(day), Number(hour), Number(minute), Number(second)),
  );
  return instant.getUTCDate() === Number(day) ? instant : undefined;
}

const DURATION = /^(?:(\d+) hours?)?(?: and )?(?:(\d+) minutes?)?$/;

/** `1 hour and 52 minutes` as 112; undefined when the text has another form. */
export function durationMinutes(value: string): number | undefined {
  const match = DURATION.exec(value.trim());
  if (match === null || (match[1] === undefined && match[2] === undefined)) return undefined;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}
