import {
  fromNewYorkWallClock,
  toNewYorkWallClockText,
} from '../../../../infrastructure/clock/new-york.js';
import type { KnownFailure, SourceDefinition } from '../../definition.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { eventListSchema, type EventList } from './event-data.js';
import { parseEventSearch } from './ticketmaster.js';

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
/** Times Square as a geohash of six characters, about 1.2 by 0.6 km. */
const GEO_POINT = 'dr5ru7';
/** 25 miles around Times Square cover the area of a venue (`eventVenueSchema`) and a little more. */
const RADIUS_MILES = 25;
/** The largest page Event Search hands over; deep paging stops at the 1,000th event. */
const PAGE_SIZE = 200;
/** New York time splits into a day part from 05:00 and a night part from 17:00. */
const PART_HOURS = [5, 17] as const;
/** Fourteen parts: today and the six days after, so this weekend is always inside. */
const TICKETMASTER_WINDOWS = 14;

export const TICKETMASTER_TERMS_URL = 'https://developer.ticketmaster.com/support/terms-of-use/';

interface Window {
  readonly start: Date;
  readonly end: Date;
}

/** Midnight UTC of a calendar date, to count days without daylight saving. */
const dayOf = (year: number, month: number, day: number): Date =>
  new Date(Date.UTC(year, month - 1, day));

function partStart(date: Date, part: 0 | 1): Date {
  const start = fromNewYorkWallClock({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: PART_HOURS[part],
    minute: 0,
    second: 0,
  });
  // 05:00 and 17:00 exist on every New York date: clocks change at 02:00.
  if (start === undefined) throw new Error(`No New York ${String(PART_HOURS[part])}:00 that day`);
  return start;
}

/** The start of the part `ahead` parts after the one holding `now`. */
function startAhead(now: Date, ahead: number): Date {
  const [date = '', time = ''] = toNewYorkWallClockText(now).split('T');
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const hour = Number(time.slice(0, 2));
  const current = hour < PART_HOURS[0] ? -1 : hour < PART_HOURS[1] ? 0 : 1;
  const target = current + ahead;
  const part = target % 2 === 0 ? 0 : 1;
  return partStart(dayOf(year, month, day + Math.floor(target / 2)), part);
}

/** The window of time a source asks for: whole parts, so its request stays the same for hours. */
export function windowAhead(now: Date, ahead: number): Window {
  return { start: startAhead(now, ahead), end: startAhead(now, ahead + 1) };
}

/** Discovery API takes instants without milliseconds: `2026-11-11T10:00:00Z`. */
const apiInstant = (instant: Date): string => `${instant.toISOString().slice(0, 19)}Z`;

/** The query of one window, the key first and every value percent-encoded. */
function eventSearchQuery(key: string, window: Window): string {
  const parameters: readonly (readonly [string, string])[] = [
    ['apikey', key],
    ['geoPoint', GEO_POINT],
    ['radius', String(RADIUS_MILES)],
    ['unit', 'miles'],
    ['startDateTime', apiInstant(window.start)],
    ['endDateTime', apiInstant(window.end)],
    ['size', String(PAGE_SIZE)],
    ['sort', 'date,asc'],
    ['locale', '*'],
  ];
  return parameters.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
}

/** The next day is read every 30 minutes, the two after every 2 hours, the rest every 6. */
function intervalOf(ahead: number): number {
  if (ahead < 2) return 30 * MINUTE;
  if (ahead < 6) return 2 * HOUR;
  return 6 * HOUR;
}

const failures: readonly KnownFailure[] = [
  {
    code: 'missing-credential',
    detection: 'TICKETMASTER_API_KEY is not set in the environment.',
    state: 'misconfigured',
    remedy: 'No request is made; the events of the other sources are served and say so.',
  },
  {
    code: 'not-json',
    detection: 'The body is not JSON, such as an error page in front of the API.',
    state: 'degraded',
    remedy: 'Keep the last good events with their age; the next run tries again.',
  },
  {
    code: 'unexpected-shape',
    detection: 'No page with `page.totalElements`, or no event in it with the documented fields.',
    state: 'misconfigured',
    remedy: 'The API changed: compare with the capture and update the reader.',
  },
  {
    code: 'http-429',
    detection: 'Over the quota: 5,000 calls a day, 5 a second (2 a second in the FAQ).',
    state: 'rate_limited',
    remedy: 'Wait as told; the windows run one at a time in the static lane.',
  },
  ...httpFailures('Ticketmaster', 'https://developer.ticketmaster.com/support/faq/'),
];

/**
 * Ticketmaster Discovery API, Event Search: the events of one part of a day within 25 miles of
 * Times Square, soonest first, one page of 200. Fourteen windows cover seven days.
 *
 * Rhythm: 176 calls a day for the fourteen, against a quota of 5,000 and well under the 2 a
 * second of the FAQ, since static sources run one at a time. The terms reserve the right to limit
 * applications that call a lot without a user asking, so far windows are read rarely. The answer
 * carries no time of its own: the time of the data is that of receipt (`dataTimeSource`).
 *
 * Terms (https://developer.ticketmaster.com/support/terms-of-use/, updated 27/06/2023): Event
 * Content belongs to the organisers and/or Ticketmaster; any purchase is governed by
 * Ticketmaster's own terms, so MovIQ links to the event page and sells nothing; content is cached
 * only for reasonable periods (one version per window) and removed within 24 hours if its owner
 * asks; the application's identity is never concealed. The credit names the API; no logo is shown.
 */
function windowSource(ahead: number): SourceDefinition<EventList> {
  const interval = intervalOf(ahead);
  return {
    id: `ticketmaster-events-${String(ahead + 1).padStart(2, '0')}`,
    title: `Ticketmaster events, day part ${String(ahead + 1)} of ${String(TICKETMASTER_WINDOWS)}`,
    provider: 'Ticketmaster Discovery API',
    licence: {
      name: 'Ticketmaster API Terms of Use',
      url: TICKETMASTER_TERMS_URL,
      attribution: 'Event data from the Ticketmaster Discovery API',
    },
    kind: 'static',
    rhythm: { class: 'cold', baseIntervalMs: interval },
    freshness: {
      degradedAfterMs: 2 * interval,
      staleAfterMs: 6 * interval,
      unavailableAfterMs: Math.max(12 * HOUR, 12 * interval),
    },
    limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
    dataTimeSource: 'receipt',
    integration: 'ticketmaster',
    keepVersions: 1,
    dataSchema: eventListSchema,
    request({ credentials, now }) {
      const query = eventSearchQuery(
        credentials['TICKETMASTER_API_KEY'] ?? '',
        windowAhead(now, ahead),
      );
      return { url: `${ENDPOINT}?${query}`, headers: { accept: 'application/json' } };
    },
    parse(body, { receivedAt }) {
      return parseEventSearch(body, receivedAt);
    },
    consumers: ['live-map', 'trip-planning'],
    failures,
  };
}

export const ticketmasterSources: readonly SourceDefinition<EventList>[] = Array.from(
  { length: TICKETMASTER_WINDOWS },
  (_, ahead) => windowSource(ahead),
);
