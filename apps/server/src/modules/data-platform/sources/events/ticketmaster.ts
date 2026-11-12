import type { EventCategory, EventStatus } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import {
  coverageOf,
  createExclusionTally,
  officialUrlOf,
  timesOf,
  venueOf,
  type EventExclusion,
  type EventList,
  type SourceEvent,
} from './event-data.js';

const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number);

const flag = z.boolean().optional();

/** A start or an end, as Discovery API documents `dates.start` and `dates.end`. */
const momentSchema = z.object({
  dateTime: z.iso.datetime().optional(),
  dateTBD: flag,
  dateTBA: flag,
  timeTBA: flag,
  noSpecificTime: flag,
  approximate: flag,
});

const named = z.object({ name: z.string() }).optional();

const classificationSchema = z.object({
  primary: z.boolean().optional(),
  segment: named,
  genre: named,
  subGenre: named,
});

const venueSchema = z.object({
  name: z.string().optional(),
  address: z.object({ line1: z.string().optional() }).optional(),
  city: named,
  location: z.object({ latitude: decimal, longitude: decimal }).optional(),
});

/** The documented status codes, with the British spelling seen in the capture of 11/11/2026. */
const statusSchema = z.enum([
  'onsale',
  'offsale',
  'canceled',
  'cancelled',
  'postponed',
  'rescheduled',
]);

const eventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  test: z.boolean().optional(),
  url: z.string().optional(),
  dates: z.object({
    start: momentSchema,
    end: momentSchema.optional(),
    status: z.object({ code: statusSchema }).optional(),
  }),
  classifications: z.array(classificationSchema).optional(),
  _embedded: z.object({ venues: z.array(venueSchema).optional() }).optional(),
});

type TicketmasterEvent = z.infer<typeof eventSchema>;

/** An answer of Event Search: `_embedded` is absent when nothing matches. */
const pageSchema = z.object({
  _embedded: z.object({ events: z.array(z.unknown()) }).optional(),
  page: z.object({
    size: z.number().int().nonnegative(),
    totalElements: z.number().int().nonnegative(),
    number: z.number().int().nonnegative(),
  }),
});

/** On sale or not, the event takes place; the status says only that it moved or was called off. */
const STATUS: Readonly<Record<z.infer<typeof statusSchema>, EventStatus>> = {
  onsale: 'scheduled',
  offsale: 'scheduled',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  postponed: 'postponed',
  rescheduled: 'rescheduled',
};

const SEGMENTS: Readonly<Record<string, EventCategory>> = {
  Music: 'music',
  Sports: 'sports',
  'Arts & Theatre': 'arts',
  Film: 'arts',
};

const MISCELLANEOUS_GENRES: Readonly<Record<string, EventCategory>> = {
  Family: 'family',
  'Fairs & Festivals': 'festival',
  'Food & Drink': 'food',
};

/** The words of the primary classification, without Ticketmaster's `Undefined` placeholder. */
function wordsOf(event: TicketmasterEvent): string[] {
  const primary = event.classifications?.find((entry) => entry.primary === true);
  return [primary?.segment?.name, primary?.genre?.name, primary?.subGenre?.name].filter(
    (word): word is string => word !== undefined && word !== '' && word !== 'Undefined',
  );
}

function categoryOf(event: TicketmasterEvent): EventCategory {
  const primary = event.classifications?.find((entry) => entry.primary === true);
  const segment = primary?.segment?.name ?? '';
  if (segment === 'Miscellaneous')
    return MISCELLANEOUS_GENRES[primary?.genre?.name ?? ''] ?? 'other';
  return SEGMENTS[segment] ?? 'other';
}

/**
 * Ticketmaster wraps every link in Impact's click tracking, `ticketmaster.evyy.net/c/<publisher>/
 * …?u=<page>`, with a placeholder publisher when the key has none. The page in `u` is the
 * official one; MovIQ links to it directly, so no click is tracked on the way.
 */
export function officialPageOf(url: string | undefined): string | undefined {
  const given = officialUrlOf(url);
  if (given === undefined) return undefined;
  const parsed = new URL(given);
  if (!parsed.hostname.endsWith('.evyy.net')) return given;
  return officialUrlOf(parsed.searchParams.get('u') ?? undefined);
}

const announced = (moment: z.infer<typeof momentSchema>): boolean =>
  moment.dateTBD !== true &&
  moment.dateTBA !== true &&
  moment.timeTBA !== true &&
  moment.noSpecificTime !== true;

function normalise(event: TicketmasterEvent, receivedAt: Date): SourceEvent | EventExclusion {
  if (event.test === true) return 'test-event';
  const { start, end } = event.dates;
  const startsAt =
    start.dateTime !== undefined && announced(start) ? new Date(start.dateTime) : undefined;
  const endsAt =
    end?.dateTime !== undefined && announced(end) && end.approximate !== true
      ? new Date(end.dateTime)
      : undefined;
  const times = timesOf(startsAt, endsAt, receivedAt);
  if (typeof times === 'string') return times;
  const place = event._embedded?.venues?.[0];
  const line = place?.address?.line1?.trim();
  const city = place?.city?.name.trim();
  const address =
    line === undefined || line === '' ? null : [line, city].filter(Boolean).join(', ');
  const venue = venueOf(
    place?.name,
    address,
    place?.location?.latitude,
    place?.location?.longitude,
  );
  if (typeof venue === 'string') return venue;
  const officialUrl = officialPageOf(event.url);
  if (officialUrl === undefined) return 'no-official-link';
  return {
    id: event.id,
    name: event.name.trim(),
    category: categoryOf(event),
    sourceCategories: wordsOf(event),
    status: STATUS[event.dates.status?.code ?? 'onsale'],
    ...times,
    venue,
    officialUrl,
  };
}

/**
 * One page of Event Search, normalised. An entry that does not have the documented form is left
 * out as `unreadable`; when no entry has it, the format changed and the page is refused.
 */
export function parseEventSearch(body: Uint8Array, receivedAt: Date): ParseResult<EventList> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const page = pageSchema.safeParse(decoded.value);
  if (!page.success) return refuse('unexpected-shape', describeIssue(page.error));
  const entries = page.data._embedded?.events ?? [];
  const tally = createExclusionTally();
  const events: SourceEvent[] = [];
  for (const entry of entries) {
    const event = eventSchema.safeParse(entry);
    const shown = event.success ? normalise(event.data, receivedAt) : 'unreadable';
    if (typeof shown === 'string') tally.add(shown);
    else events.push(shown);
  }
  const unreadable = tally.counts.find((entry) => entry.reason === 'unreadable')?.count ?? 0;
  if (entries.length > 0 && unreadable === entries.length) {
    return refuse('unexpected-shape', `None of the ${String(entries.length)} events is readable.`);
  }
  const { totalElements, number, size } = page.data.page;
  const data: EventList = {
    events,
    excluded: tally.counts,
    providerTotal: totalElements,
    complete: number * size + entries.length >= totalElements,
  };
  return { ok: true, data, dataTime: receivedAt, coverage: coverageOf(data) };
}
