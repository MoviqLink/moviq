import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseContext, ParseResult, SourceDefinition } from '../../definition.js';
import { fromNewYorkWallClock } from '../../../../infrastructure/clock/new-york.js';
import {
  HTTP_FAILURES,
  HOUR,
  MINUTE,
  MTA_FEEDS_URL,
  MTA_LICENCE,
  MTA_PROVIDER,
  count,
} from './provider.js';

const yesNo = z.enum(['Y', 'N']).transform((value) => value === 'Y');

/** One row of `nyct_ene.json` as the MTA publishes it. */
const outageRow = z.object({
  station: z.string().min(1),
  trainno: z.string(),
  equipment: z.string().min(1),
  equipmenttype: z.enum(['EL', 'ES']),
  serving: z.string(),
  ADA: yesNo,
  outagedate: z.string(),
  estimatedreturntoservice: z.string(),
  reason: z.string(),
  isupcomingoutage: yesNo,
  ismaintenanceoutage: yesNo,
});

const outageSchema = z.object({
  equipmentId: z.string().min(1),
  kind: z.enum(['elevator', 'escalator']),
  /** The station name as the MTA writes it; the feed gives no GTFS stop id. */
  station: z.string().min(1),
  lines: z.array(z.string().min(1)),
  serving: z.string(),
  /** Part of the step-free path of the station. */
  ada: z.boolean(),
  reason: z.string(),
  since: instantSchema,
  estimatedReturn: instantSchema.nullable(),
  /** Announced and not started yet. */
  upcoming: z.boolean(),
  maintenance: z.boolean(),
});

export const elevatorOutagesSchema = z.object({
  /** When the list was read: the feed carries no time of its own. */
  readAt: instantSchema,
  outages: z.array(outageSchema),
});

export type ElevatorOutages = z.infer<typeof elevatorOutagesSchema>;
type ElevatorOutage = z.infer<typeof outageSchema>;

type Refusal = Extract<ParseResult<ElevatorOutages>, { ok: false }>;

/** "11/10/2026 06:37:00 PM", New York wall clock, to an instant. */
function mtaTime(text: string): Date | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/.exec(text.trim());
  if (!match) return undefined;
  const hour = Number(match[4]);
  if (hour < 1 || hour > 12) return undefined;
  return fromNewYorkWallClock({
    year: Number(match[3]),
    month: Number(match[1]),
    day: Number(match[2]),
    hour: (hour % 12) + (match[7] === 'PM' ? 12 : 0),
    minute: Number(match[5]),
    second: Number(match[6]),
  });
}

function readRows(body: Uint8Array): z.output<typeof outageRow>[] | Refusal {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: 'not-json', detail };
  }
  const parsed = z.array(outageRow).safeParse(json);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const detail = `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`;
  return { ok: false, code: 'unexpected-shape', detail };
}

function toOutage(row: z.output<typeof outageRow>): ElevatorOutage | string {
  const since = mtaTime(row.outagedate);
  const back = row.estimatedreturntoservice.trim();
  const estimatedReturn = back === '' ? null : mtaTime(back);
  if (since === undefined) return `${row.equipment}: outage date "${row.outagedate}"`;
  if (estimatedReturn === undefined) return `${row.equipment}: return date "${back}"`;
  return {
    equipmentId: row.equipment,
    kind: row.equipmenttype === 'EL' ? 'elevator' : 'escalator',
    station: row.station,
    lines: row.trainno
      .split('/')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
    serving: row.serving.trim(),
    ada: row.ADA,
    reason: row.reason,
    since: toInstant(since),
    estimatedReturn: estimatedReturn === null ? null : toInstant(estimatedReturn),
    upcoming: row.isupcomingoutage,
    maintenance: row.ismaintenanceoutage,
  };
}

function describe(outages: readonly ElevatorOutage[]): string {
  const now = outages.filter((outage) => !outage.upcoming);
  const elevators = now.filter((outage) => outage.kind === 'elevator').length;
  return [
    `${count(now.length, 'out of service now')} (${String(elevators)} elevators,`,
    `${String(now.length - elevators)} escalators),`,
    count(outages.length - now.length, 'announced'),
  ].join(' ');
}

/**
 * The feed has no header, no `Last-Modified` and no ETag, and is generated on each request
 * (`x-cache: Miss`), so the time of receipt stands in for the time of the data. Freshness then
 * proves only that the feed answered, not that the state of each elevator was updated.
 */
function parseElevators(
  body: Uint8Array,
  context: ParseContext<ElevatorOutages>,
): ParseResult<ElevatorOutages> {
  const rows = readRows(body);
  if (!Array.isArray(rows)) return rows;
  const outages: ElevatorOutage[] = [];
  for (const row of rows) {
    const outage = toOutage(row);
    if (typeof outage === 'string') return { ok: false, code: 'bad-date', detail: outage };
    outages.push(outage);
  }
  // Capital replacements keep equipment out for months, so an empty list is a failure.
  if (outages.length === 0) return { ok: false, code: 'empty-feed', detail: 'an empty list' };
  return {
    ok: true,
    data: { readAt: toInstant(context.receivedAt), outages },
    dataTime: context.receivedAt,
    coverage: describe(outages),
  };
}

export const mtaElevators: SourceDefinition<ElevatorOutages> = {
  id: 'mta-elevators',
  title: 'MTA subway elevator and escalator outages',
  provider: MTA_PROVIDER,
  licence: MTA_LICENCE,
  kind: 'realtime',
  // Outages start and end all day: 10 of the 37 current on 11/11/2026 began in the 12 hours before.
  rhythm: { class: 'warm', baseIntervalMs: 5 * MINUTE, interestIntervalMs: 2 * MINUTE },
  // Measured from the last good read, since the feed carries no time of its own: it says the feed
  // answered, not that the MTA updated the state of each elevator and escalator.
  freshness: { degradedAfterMs: 15 * MINUTE, staleAfterMs: HOUR, unavailableAfterMs: 3 * HOUR },
  limits: { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: elevatorOutagesSchema,
  request() {
    return { url: `${MTA_FEEDS_URL}nyct%2Fnyct_ene.json` };
  },
  parse(body, context) {
    return parseElevators(body, context);
  },
  consumers: ['step-free', 'trip-watch'],
  failures: [
    ...HTTP_FAILURES,
    {
      code: 'not-json',
      detection: 'The body is not JSON, as with an HTML error page',
      state: 'degraded',
      remedy: 'Retry on the next run; the last good list is served with its age',
    },
    {
      code: 'unexpected-shape',
      detection: 'The JSON is not a list of outages with the published fields and codes',
      state: 'misconfigured',
      remedy: 'An operator compares the feed with the MTA elevator and escalator documentation',
    },
    {
      code: 'bad-date',
      detection: 'An outage or return date is not "MM/DD/YYYY hh:mm:ss AM"',
      state: 'misconfigured',
      remedy: 'An operator checks the row named in the detail',
    },
    {
      code: 'empty-feed',
      detection: 'An empty list, while capital replacements keep equipment out for months',
      state: 'degraded',
      remedy: 'Refused, so a broken feed never reads as "all elevators work"',
    },
  ],
};
