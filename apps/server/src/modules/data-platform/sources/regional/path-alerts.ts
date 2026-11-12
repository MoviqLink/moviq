import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type {
  KnownFailure,
  ParseContext,
  ParseResult,
  SourceDefinition,
} from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { MINUTE, count } from '../mta/provider.js';
import { httpFailures } from './provider-failures.js';

/** The four PATH lines, as the alerts write them. */
const PATH_LINES = ['NWK-WTC', 'HOB-WTC', 'JSQ-33', 'HOB-33'] as const;

/**
 * One alert as panynj.gov publishes it. `SentBy`, the name of the person who sent it, is never
 * read, so it is neither stored nor shown.
 */
const rowSchema = z.object({
  ebid: z.number().int(),
  messageid: z.number().int(),
  sentdate2: z.string(),
  Subject: z.string(),
  SentMessage: z.string(),
  TemplateName: z.string().nullish(),
  state: z.enum(['Open', 'Closed']),
});

const alertSchema = z.object({
  id: z.string().min(1),
  /** The messages of one incident share it: an alert, its updates and its final update. */
  incidentId: z.string().min(1),
  /** The kind of alert, from the template PATH sends it with: `Mechanical Problem`… */
  kind: z.string().min(1).nullable(),
  subject: z.string().min(1),
  /** The text as sent, without blank lines. */
  text: z.string(),
  sentAt: instantSchema,
  /** The incident state PATH gives: open, or closed once resolved or sent as a one-off notice. */
  state: z.enum(['open', 'closed']),
  /**
   * The lines the subject or text name, affected or not: the text says how (`NWK-WTC delayed`,
   * `JSQ-33 running`). Empty when it names none, as for a station or the whole system.
   */
  linesNamed: z.array(z.enum(PATH_LINES)),
});

export const pathAlertsSchema = z.object({
  /** When the list was read: the answer carries no time of its own. */
  readAt: instantSchema,
  /** Newest first, as published; empty when PATH has nothing to announce. */
  alerts: z.array(alertSchema),
  /** Rows without a readable send time. */
  leftOut: z.number().int().nonnegative(),
});

export type PathAlerts = z.infer<typeof pathAlertsSchema>;
type PathAlert = z.infer<typeof alertSchema>;
type Row = z.infer<typeof rowSchema>;

/** `/Date(1794366877549)/`: milliseconds since 1970, the only send time with its zone. */
function sentAtOf(value: string): string | null {
  const match = /^\/Date\((\d+)\)\/$/.exec(value);
  return match ? toInstant(new Date(Number(match[1]))) : null;
}

function linesNamed(text: string): PathAlert['linesNamed'] {
  return PATH_LINES.filter((line) => new RegExp(`\\b${line}\\b`).test(text));
}

function plainText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

function alertOf(row: Row): PathAlert | undefined {
  const sentAt = sentAtOf(row.sentdate2);
  const subject = row.Subject.trim();
  if (sentAt === null || subject === '') return undefined;
  const text = plainText(row.SentMessage);
  const kind = row.TemplateName?.replace(/^PATH\s*-\s*/, '').trim() ?? '';
  return {
    id: String(row.messageid),
    incidentId: String(row.ebid),
    kind: kind === '' ? null : kind,
    subject,
    text,
    sentAt,
    state: row.state === 'Open' ? 'open' : 'closed',
    linesNamed: linesNamed(`${subject}\n${text}`),
  };
}

function parseAlerts(body: Uint8Array, context: ParseContext<PathAlerts>): ParseResult<PathAlerts> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const rows = z.array(rowSchema).safeParse(decoded.value);
  if (!rows.success) return refuse('unexpected-shape', describeIssue(rows.error));
  const alerts = rows.data.flatMap((row) => alertOf(row) ?? []);
  const leftOut = rows.data.length - alerts.length;
  const open = alerts.filter((alert) => alert.state === 'open').length;
  return {
    ok: true,
    data: { readAt: toInstant(context.receivedAt), alerts, leftOut },
    dataTime: context.receivedAt,
    coverage: `${count(alerts.length, 'alerts')} (${String(open)} open), ${String(leftOut)} left out`,
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('panynj.gov', 'the PATH alerts page of panynj.gov'),
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an HTML maintenance page of panynj.gov',
    state: 'degraded',
    remedy: 'Keep the last good list with its age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection:
      'Not a list of alerts with a subject, a message, a send time and an Open or Closed state',
    state: 'misconfigured',
    remedy: 'The Port Authority changed its format: compare with the capture and update the reader',
  },
];

/**
 * PATH service alerts, the list behind the alerts of panynj.gov and the RidePATH app
 * (`/bin/portauthority/alerts?agency=PATH`, cited by the PATH page template). On 11/11/2026 it
 * held the 5 messages of the last 8 hours, so an empty list is a quiet spell, not a failure.
 *
 * Rhythm and freshness: answers are cached for a minute (`cache-control: max-age=60`) and the
 * newest message was 42 minutes old; every 2 minutes, every minute while a trip is watched. The
 * list has no time of its own, so freshness is measured from the last good read.
 */
export const pathAlertsSource: SourceDefinition<PathAlerts> = {
  id: 'path-alerts',
  title: 'PATH service alerts',
  provider: 'Port Authority of New York and New Jersey (PATH)',
  licence: {
    name: 'panynj.gov Web Site Disclaimer',
    url: 'https://www.panynj.gov/port-authority/en/web-site-disclaimer.html',
    attribution: 'Service alerts from the Port Authority of New York and New Jersey (PATH)',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: {
    degradedAfterMs: 10 * MINUTE,
    staleAfterMs: 20 * MINUTE,
    unavailableAfterMs: 60 * MINUTE,
  },
  limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: pathAlertsSchema,
  request() {
    return {
      url: 'https://www.panynj.gov/bin/portauthority/alerts?agency=PATH',
      headers: { accept: 'application/json' },
    };
  },
  parse(body, context) {
    return parseAlerts(body, context);
  },
  consumers: ['service-alerts', 'trip-watch', 'live-map'],
  failures: FAILURES,
};
