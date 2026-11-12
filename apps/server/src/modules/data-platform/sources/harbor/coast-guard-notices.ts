import { instantSchema, toInstant } from '@moviq/contracts';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import type {
  KnownFailure,
  ParseContext,
  ParseResult,
  SourceDefinition,
} from '../../definition.js';
import { tagBalanceProblem } from '../city/faa-nas-status-xml.js';
import { decodeText, describeIssue, refuse } from '../city/parsing.js';
import { HOUR, MINUTE, count } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { htmlLines } from './html-text.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'item',
});

const itemSchema = z.object({
  title: z.string().min(1),
  pubDate: z.string(),
  guid: z.string().min(1),
  link: z.string().optional(),
  description: z.string().default(''),
});

const documentSchema = z.object({
  rss: z.object({ channel: z.object({ item: z.array(itemSchema).default([]) }) }),
});

const noticeSchema = z.object({
  id: z.string().min(1),
  /** The first word of the title: SAFETY, URGENT, SCHEDULED, UPDATE or CANCELLATION. */
  category: z.string().min(1),
  /** The waterway or place the title names, as written (`NY - JAMAICA BAY`). */
  area: z.string().nullable(),
  /** What it is about, as the title says: ATON (aids to navigation), BRIDGE, MARINE EVENT… */
  subject: z.string().nullable(),
  /** `SEC SNY BNM 0556-26`; for a cancellation, the notice it cancels. */
  reference: z.string().nullable(),
  publishedAt: instantSchema,
  /** The automatic end the notice gives (`CANCEL AT//012300Z NOV 26//`), or null. */
  endsAt: instantSchema.nullable(),
  /** When a later cancellation in the feed ended it, or null when none in the feed did. */
  cancelledAt: instantSchema.nullable(),
  /** The text without the point-of-contact line, which names a person and a telephone. */
  text: z.string(),
  link: z.url().nullable(),
});

export const coastGuardNoticesSchema = z.object({
  /** When the feed was read: the feed itself carries no time. */
  readAt: instantSchema,
  /** Newest first, as published: the latest 100 broadcast notices, whatever their age. */
  notices: z.array(noticeSchema),
  /** Items without a readable publication time. */
  leftOut: z.number().int().nonnegative(),
});

type CoastGuardNotices = z.infer<typeof coastGuardNoticesSchema>;
type Notice = z.infer<typeof noticeSchema>;
type Item = z.infer<typeof itemSchema>;

const REFERENCE = /\bSEC\s*([A-Z]+)\s+BNM\s+(\d{3,4}-\d{2})\b/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const CANCEL_AT = /CANCEL AT\s*\/\/\s*(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{2})\s*\/\//;
const POINT_OF_CONTACT = /^(?:\d+\.|[A-Z]\.)?\s*POC\b/;

/** `012300Z NOV 26`, a military date-time group in UTC, as an instant. */
function endOf(text: string): string | null {
  const match = CANCEL_AT.exec(text);
  if (match === null) return null;
  const [day = 0, hour = 0, minute = 0] = match.slice(1, 4).map(Number);
  const month = MONTHS.indexOf(match[4] ?? '');
  const year = 2000 + Number(match[5]);
  const instant = new Date(Date.UTC(year, month, day, hour, minute));
  const real = month >= 0 && instant.getUTCDate() === day && hour < 24 && minute < 60;
  return real ? toInstant(instant) : null;
}

/** `CATEGORY/AREA/SUBJECT/SEC SNY BNM 0556-26`, or `CANCELLATION/SEC SNY BNM 0554-26`. */
function titleParts(title: string): Pick<Notice, 'category' | 'area' | 'subject' | 'reference'> {
  const parts = title.split('/').map((part) => part.trim());
  const category = parts[0] === undefined || parts[0] === '' ? 'UNKNOWN' : parts[0];
  const match = REFERENCE.exec(parts.at(-1) ?? '');
  const reference = match ? `SEC ${match[1] ?? ''} BNM ${match[2] ?? ''}` : null;
  if (reference === null || parts.length < 3)
    return { category, area: null, subject: null, reference };
  const area = parts.slice(1, Math.max(2, parts.length - 2)).join('/');
  const subject = parts.length >= 4 ? (parts.at(-2) ?? null) : null;
  return { category, area: area === '' ? null : area, subject, reference };
}

function noticeOf(item: Item): Notice | undefined {
  const published = Date.parse(item.pubDate);
  if (Number.isNaN(published)) return undefined;
  const lines = htmlLines(item.description).filter(
    (line) => line !== 'BT' && !POINT_OF_CONTACT.test(line),
  );
  const link = z.url().safeParse(item.link?.trim());
  return {
    id: item.guid.trim(),
    ...titleParts(item.title.trim()),
    publishedAt: toInstant(new Date(published)),
    endsAt: endOf(lines.join('\n')),
    cancelledAt: null,
    text: lines.join('\n'),
    link: link.success ? link.data : null,
  };
}

/** Marks each notice a later cancellation in the same feed names. */
function withCancellations(notices: readonly Notice[]): Notice[] {
  const cancellations = notices.filter((notice) => notice.category === 'CANCELLATION');
  return notices.map((notice) => {
    if (notice.category === 'CANCELLATION' || notice.reference === null) return notice;
    const cancelling = cancellations.filter(
      (one) => one.reference === notice.reference && one.publishedAt > notice.publishedAt,
    );
    const first = cancelling.map((one) => one.publishedAt).sort()[0];
    return first === undefined ? notice : { ...notice, cancelledAt: first };
  });
}

function parseNotices(
  body: Uint8Array,
  context: ParseContext<CoastGuardNotices>,
): ParseResult<CoastGuardNotices> {
  const decoded = decodeText(body);
  if (!decoded.ok) return decoded;
  // Notice texts come as HTML inside CDATA, which says nothing about the feed's own tags.
  const problem = tagBalanceProblem(decoded.text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''));
  if (problem !== undefined)
    return refuse('not-xml', `The body is not well-formed XML: ${problem}.`);
  const parsed = documentSchema.safeParse(parser.parse(decoded.text));
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const items = parsed.data.rss.channel.item;
  const notices = withCancellations(items.flatMap((item) => noticeOf(item) ?? []));
  if (notices.length === 0) return refuse('empty-feed', 'The feed lists no notice.');
  const cancelled = notices.filter((notice) => notice.cancelledAt !== null).length;
  return {
    ok: true,
    data: {
      readAt: toInstant(context.receivedAt),
      notices,
      leftOut: items.length - notices.length,
    },
    dataTime: context.receivedAt,
    coverage: `${count(notices.length, 'notices')}, ${String(cancelled)} cancelled by a later one`,
  };
}

const FAILURES: readonly KnownFailure[] = [
  ...httpFailures('public.govdelivery.com', 'the RSS list of https://www.navcen.uscg.gov/'),
  {
    code: 'not-text',
    detection: 'The body is not UTF-8 text',
    state: 'degraded',
    remedy: 'Keep the last good list with its age; the next run tries again',
  },
  {
    code: 'not-xml',
    detection: 'A tag left open or closed out of order, as in a cut answer or an HTML error page',
    state: 'degraded',
    remedy: 'Keep the last good list with its age; the next run tries again',
  },
  {
    code: 'unexpected-shape',
    detection: 'No RSS channel, or an item without a title, a date or an id',
    state: 'misconfigured',
    remedy: 'GovDelivery changed the feed: compare with the capture and update the reader',
  },
  {
    code: 'empty-feed',
    detection: 'No notice at all, while the feed always holds the latest ones',
    state: 'degraded',
    remedy: 'Refused, so a broken feed never reads as "no notices"; the last list ages',
  },
];

/**
 * Broadcast Notices to Mariners of Coast Guard Sector New York: aids to navigation off station,
 * bridges out of order, marine events and safety zones. NAVCEN links this GovDelivery RSS
 * (https://www.navcen.uscg.gov/subscribe-email-rss-feeds); it answers without a key.
 *
 * Rhythm and freshness: Sector New York issued 6 notices from 07/11 to 10/11/2026, and the feed is
 * built on each request (`no-store`, 4.5 s on 11/11/2026), so every 15 minutes is enough. It has
 * no time of its own: freshness is measured from the last good read.
 */
export const coastGuardNotices: SourceDefinition<CoastGuardNotices> = {
  id: 'uscg-sector-new-york-notices',
  title: 'Coast Guard Sector New York broadcast notices to mariners',
  provider: 'U.S. Coast Guard, Sector New York (GovDelivery RSS)',
  licence: {
    name: 'U.S. Government work, public domain',
    url: 'https://www.usa.gov/government-copyright',
    attribution: 'Broadcast Notices to Mariners from the U.S. Coast Guard, Sector New York',
  },
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 15 * MINUTE },
  freshness: { degradedAfterMs: 45 * MINUTE, staleAfterMs: 2 * HOUR, unavailableAfterMs: 6 * HOUR },
  limits: { timeoutMs: 30_000, maxBytes: 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: coastGuardNoticesSchema,
  request() {
    return {
      url: 'https://public.govdelivery.com/topics/USDHSCG_379/feed.rss',
      headers: { accept: 'application/rss+xml' },
    };
  },
  parse(body, context) {
    return parseNotices(body, context);
  },
  consumers: ['live-map', 'service-alerts'],
  failures: FAILURES,
};
