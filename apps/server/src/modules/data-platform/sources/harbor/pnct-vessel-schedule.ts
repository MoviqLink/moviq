import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import { fromNewYorkWallClockText } from '../../../../infrastructure/clock/new-york.js';
import type {
  KnownFailure,
  ParseContext,
  ParseResult,
  SourceDefinition,
} from '../../definition.js';
import { decodeText, describeIssue, refuse } from '../city/parsing.js';
import { HOUR, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { decodeEntities } from './html-text.js';

/** The opening tag of the schedule block; the list is its `data-ds` attribute, as JSON. */
const BLOCK = /<div\b[^>]*\bid="divVslSchedules"[^>]*>/;
const DATA_DS = /\bdata-ds="([^"]*)"/;

const wallClock = z.string().nullable();

/** One call as the page lists it; times are New York wall-clock times without a zone. */
const rowSchema = z.object({
  VisitReference: z.string().min(1),
  VesselName: z.string().min(1),
  VesselCode: z.string().nullable(),
  LineOperator: z.string().nullable(),
  IbVoyNumber: z.string().nullable(),
  ObVoyNumber: z.string().nullable(),
  EstimatedArrival: wallClock,
  /** `ActualArrival` in the column headings of the page. */
  Arrival: wallClock,
  EstimatedDeparture: wallClock,
  /** `ActualDeparture` in the column headings of the page. */
  Departure: wallClock,
});

const instant = instantSchema.nullable();

const callSchema = z.object({
  /** The terminal's id of the call: vessel code and voyages (`ANIS-641A-645A`). */
  visit: z.string().min(1),
  vessel: z.string().min(1),
  vesselCode: z.string().nullable(),
  line: z.string().nullable(),
  inboundVoyage: z.string().nullable(),
  outboundVoyage: z.string().nullable(),
  expectedArrival: instant,
  arrived: instant,
  expectedDeparture: instant,
  departed: instant,
  /** From the actual times only: no actual time yet, alongside since `arrived`, or gone. */
  stage: z.enum(['announced', 'at-berth', 'departed']),
});

export const pnctScheduleSchema = z.object({
  /** When the page was read: it carries no time of its own. */
  readAt: instantSchema,
  calls: z.array(callSchema),
  /** Calls with a time that is not a real New York time. */
  leftOut: z.number().int().nonnegative(),
});

type PnctSchedule = z.infer<typeof pnctScheduleSchema>;
type Call = z.infer<typeof callSchema>;
type Row = z.infer<typeof rowSchema>;

/** The instant of a wall-clock time, null when absent, undefined when not a real time. */
function instantOf(text: string | null): string | null | undefined {
  if (text === null) return null;
  const parsed = fromNewYorkWallClockText(text);
  return parsed === undefined ? undefined : toInstant(parsed);
}

function stageOf(arrived: string | null, departed: string | null): Call['stage'] {
  if (departed !== null) return 'departed';
  return arrived === null ? 'announced' : 'at-berth';
}

function callOf(row: Row): Call | undefined {
  const times = [row.EstimatedArrival, row.Arrival, row.EstimatedDeparture, row.Departure].map(
    instantOf,
  );
  const [expectedArrival, arrived, expectedDeparture, departed] = times;
  if (
    expectedArrival === undefined ||
    arrived === undefined ||
    expectedDeparture === undefined ||
    departed === undefined
  ) {
    return undefined;
  }
  return {
    visit: row.VisitReference,
    vessel: row.VesselName.trim(),
    vesselCode: row.VesselCode,
    line: row.LineOperator,
    inboundVoyage: row.IbVoyNumber,
    outboundVoyage: row.ObVoyNumber,
    expectedArrival,
    arrived,
    expectedDeparture,
    departed,
    stage: stageOf(arrived, departed),
  };
}

/** The JSON list in the `data-ds` attribute of the schedule block, as an unknown value. */
function embeddedList(page: string): { readonly value: unknown } | undefined {
  const block = BLOCK.exec(page)?.[0];
  const attribute = block === undefined ? undefined : DATA_DS.exec(block)?.[1];
  if (attribute === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(decodeEntities(attribute));
    return { value };
  } catch {
    return undefined;
  }
}

function parseSchedule(
  body: Uint8Array,
  context: ParseContext<PnctSchedule>,
): ParseResult<PnctSchedule> {
  const decoded = decodeText(body);
  if (!decoded.ok) return decoded;
  const list = embeddedList(decoded.text);
  if (list === undefined) {
    return refuse('no-schedule', 'The page has no schedule block with a JSON list.');
  }
  const rows = z.array(rowSchema).safeParse(list.value);
  if (!rows.success) return refuse('unexpected-shape', describeIssue(rows.error));
  const calls = rows.data.flatMap((row) => callOf(row) ?? []);
  // The terminal always has calls ahead, so an empty schedule is a failure, not a quiet week.
  if (calls.length === 0) return refuse('empty-schedule', 'The schedule lists no vessel call.');
  const atBerth = calls.filter((call) => call.stage === 'at-berth').length;
  const departed = calls.filter((call) => call.stage === 'departed').length;
  return {
    ok: true,
    data: {
      readAt: toInstant(context.receivedAt),
      calls,
      leftOut: rows.data.length - calls.length,
    },
    dataTime: context.receivedAt,
    coverage: `${count(calls.length, 'vessel calls')}, ${String(atBerth)} at berth, ${String(departed)} gone`,
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('www.pnct.net', 'https://www.pnct.net/VesselSchedule'),
  {
    code: 'not-text',
    detection: 'The body is not UTF-8 text',
    state: 'degraded',
    remedy: 'Keep the last good schedule with its age; the next run tries again',
  },
  {
    code: 'no-schedule',
    detection: 'The page has no divVslSchedules block with a JSON list, as a challenge page',
    state: 'misconfigured',
    remedy: 'PNCT changed its page: compare with the capture and update the reader',
  },
  {
    code: 'unexpected-shape',
    detection: 'The list lacks a call reference, a vessel name or the four times',
    state: 'misconfigured',
    remedy: 'PNCT changed its list: compare with the capture and update the reader',
  },
  {
    code: 'empty-schedule',
    detection: 'No vessel call at all, while the terminal publishes weeks ahead',
    state: 'degraded',
    remedy: 'Refused; the last good schedule is served with its age until it runs out',
  },
];

/**
 * Vessel calls at Port Newark Container Terminal, from its public schedule page: 35 calls on
 * 11/11/2026, with the expected and actual arrival and departure of each (9 had arrived and 7
 * had left). The page embeds the list it shows; its times have no zone and are read as New York
 * time, the terminal's own.
 *
 * Rhythm and freshness: actual times are entered as ships berth and sail, a few a day, so a read
 * every 15 minutes follows them; the page has no time of its own, so freshness is measured from
 * the last good read. Licence: the PNCT Terms of Use page, whose text was empty on 11/11/2026,
 * and the site's "All rights reserved".
 */
export const pnctVesselSchedule: SourceDefinition<PnctSchedule> = {
  id: 'pnct-vessel-schedule',
  title: 'Port Newark Container Terminal vessel schedule',
  provider: 'Port Newark Container Terminal (PNCT), a Ports America terminal',
  licence: {
    name: 'PNCT Terms of Use, all rights reserved',
    url: 'https://www.pnct.net/content/show/TermsOfUse',
    attribution: 'Vessel schedule from Port Newark Container Terminal (PNCT)',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 15 * MINUTE },
  freshness: { degradedAfterMs: 45 * MINUTE, staleAfterMs: 2 * HOUR, unavailableAfterMs: 6 * HOUR },
  limits: { timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: pnctScheduleSchema,
  request() {
    return { url: 'https://www.pnct.net/VesselSchedule', headers: { accept: 'text/html' } };
  },
  parse(body, context) {
    return parseSchedule(body, context);
  },
  consumers: ['live-map'],
  failures: FAILURES,
};
