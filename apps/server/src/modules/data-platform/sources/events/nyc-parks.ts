import type { EventCategory, EventStatus } from '@moviq/contracts';
import { z } from 'zod';

import { fromNewYorkWallClockText } from '../../../../infrastructure/clock/new-york.js';
import type { ParseResult, SourceDefinition } from '../../definition.js';
import { decodeJson, describeIssue, refuse } from '../city/parsing.js';
import { HOUR } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  coverageOf,
  createExclusionTally,
  eventListSchema,
  officialUrlOf,
  timesOf,
  venueOf,
  type EventExclusion,
  type EventList,
  type SourceEvent,
} from './event-data.js';

const ENDPOINT = 'https://data.cityofnewyork.us/resource/w3wp-dpdi.json';
/** The dataset holds two weeks of events, 578 on 11/11/2026; a full page means some were cut. */
const ROW_LIMIT = 5000;
const FIELDS = [
  ':updated_at',
  'guid',
  'title',
  'link',
  'starttime',
  'endtime',
  'location',
  'parknames',
  'coordinates',
  'categories',
];

const rowSchema = z.object({
  /** Socrata's time of the last load, in UTC; every row of a daily load carries the same. */
  ':updated_at': z.iso.datetime(),
  guid: z.string().regex(/^\d+$/),
  title: z.string().min(1),
  link: z.object({ url: z.string() }).optional(),
  starttime: z.string().optional(),
  endtime: z.string().optional(),
  location: z.string().optional(),
  parknames: z.string().optional(),
  coordinates: z.string().optional(),
  categories: z.string().optional(),
});

type Row = z.infer<typeof rowSchema>;

/** `40.859411944915, -73.934134840965`, or several such pairs joined by `; `: the first counts. */
const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:;|$)/;

/** The first category of the list that MovIQ maps decides, so this order goes from most specific. */
const CATEGORY_RULES: readonly (readonly [EventCategory, readonly string[]])[] = [
  ['festival', ['Festivals', 'Fall Festivals', 'Arts, Culture & Fun Series']],
  ['music', ['Concerts', 'Music']],
  ['family', ['Best for Kids', 'Kids', 'Family']],
  ['sports', ['Sports', 'Basketball/Netball', 'Football', 'Running/Jogging', 'Swimming/Aquatics']],
  ['fitness', ['Fitness', 'Exercise Classes', 'Outdoor Fitness', 'Yoga & Pilates Classes']],
  [
    'arts',
    ['Art', 'Arts & Crafts', 'Dance', 'Dance Classes', 'Theater', 'History', 'Talks', 'Tours'],
  ],
  ['outdoors', ['Nature', 'Wildlife', 'Birding', 'Hiking', 'Gardening', 'Waterfront', 'Walking']],
  ['food', ['Food', 'Markets']],
  ['community', ['Volunteer', "It's My Park", 'Community Input Meetings', 'Education']],
];

function categoryOf(words: readonly string[]): EventCategory {
  const given = new Set(words);
  return CATEGORY_RULES.find(([, names]) => names.some((name) => given.has(name)))?.[0] ?? 'other';
}

function pointOf(text: string | undefined): { lat: number; lon: number } | undefined {
  const match = PAIR.exec(text ?? '');
  if (match === null) return undefined;
  return { lat: Number(match[1]), lon: Number(match[2]) };
}

const wallClock = (text: string | undefined): Date | undefined =>
  text === undefined ? undefined : fromNewYorkWallClockText(text);

/** Parks calls an event off in its title: `CANCELLED: Team RIVER Volunteers` (11/11/2026). */
const CALLED_OFF = /^\s*(CANCELL?ED|POSTPONED)\s*[:\-–]\s*/i;

function statusOf(title: string): { readonly name: string; readonly status: EventStatus } {
  const match = CALLED_OFF.exec(title);
  if (match === null) return { name: title.trim(), status: 'scheduled' };
  const status = match[1]?.toUpperCase() === 'POSTPONED' ? 'postponed' : 'cancelled';
  return { name: title.slice(match[0].length).trim(), status };
}

/**
 * The place of the first coordinates: with several, `location` lists them in the same order,
 * `Entrance to John Golden Park (in John Golden Park),John Golden Parking Lot (in …)`.
 */
function firstPlace(location: string | undefined, places: number): string | undefined {
  if (location === undefined || places < 2) return location;
  const [first] = location.split(/\),\s*/);
  return first === undefined || first === location ? location : `${first})`;
}

function normalise(row: Row, receivedAt: Date): SourceEvent | EventExclusion {
  const times = timesOf(wallClock(row.starttime), wallClock(row.endtime), receivedAt);
  if (typeof times === 'string') return times;
  const point = pointOf(row.coordinates);
  const places = (row.coordinates ?? '').split(';').length;
  // The place inside the park, such as "Margaret Corbin Circle (in Fort Tryon Park)", or the park.
  const name = firstPlace(row.location, places) ?? row.parknames;
  const venue = venueOf(name, null, point?.lat, point?.lon);
  if (typeof venue === 'string') return venue;
  const officialUrl = officialUrlOf(row.link?.url);
  if (officialUrl === undefined) return 'no-official-link';
  const words = (row.categories ?? '')
    .split('|')
    .map((word) => word.trim())
    .filter((word) => word !== '');
  return {
    id: row.guid,
    ...statusOf(row.title),
    category: categoryOf(words),
    sourceCategories: words,
    ...times,
    venue,
    officialUrl,
  };
}

function parseParks(body: Uint8Array, receivedAt: Date): ParseResult<EventList> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const rows = z.array(rowSchema).safeParse(decoded.value);
  if (!rows.success) return refuse('unexpected-shape', describeIssue(rows.error));
  if (rows.data.length === 0) return refuse('empty', 'The dataset answered with no event at all.');
  const tally = createExclusionTally();
  const events: SourceEvent[] = [];
  for (const row of rows.data) {
    const shown = normalise(row, receivedAt);
    if (typeof shown === 'string') tally.add(shown);
    else events.push(shown);
  }
  const loaded = Math.max(...rows.data.map((row) => Date.parse(row[':updated_at'])));
  const data: EventList = {
    events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)),
    excluded: tally.counts,
    providerTotal: null,
    complete: rows.data.length < ROW_LIMIT,
  };
  return { ok: true, data, dataTime: new Date(loaded), coverage: coverageOf(data) };
}

/** The query string, with `$` kept as Socrata writes it and values percent-encoded. */
function socrataQuery(): string {
  const parameters = [
    ['$select', FIELDS.join(',')],
    ['$order', 'guid'],
    ['$limit', String(ROW_LIMIT)],
  ];
  return parameters
    .map(([key = '', value = '']) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

export const NYC_PARKS_TERMS_URL = 'https://www.nyc.gov/main/terms-of-use';

/**
 * NYC Parks Public Events – Upcoming 14 Days (NYC Open Data, dataset w3wp-dpdi): the public events
 * on Parks properties for the next two weeks, with title, start and end, place in the park, its
 * coordinates, categories and the page of the event on nycgovparks.org.
 *
 * Times: `starttime` and `endtime` are New York times without zone (Socrata floating timestamps);
 * on 11/11/2026 the 576 starts peaked at 10–11 and 18 h with none from 21 to 07 h but one, which
 * only local time explains. `coordinates` is `latitude, longitude`, three events gave two pairs
 * (`; `): the first one, the meeting place, is used. The time of the data is Socrata's
 * `:updated_at` of the load. `image` (a third party's picture) and `contact_phone` are not read.
 *
 * Rhythm and freshness: the metadata says "Update Frequency: Daily" (the load of 10/11/2026 was at
 * 14:09 UTC). Asking every 3 hours finds each load the same morning; Socrata's ETag makes the
 * repeats cheap. A load of 28 hours is degraded, of 50 stale, and of 3 days unavailable: by then
 * cancellations are unknown.
 *
 * Licence: the NYC.gov terms of use; NYC Open Data is free to use, with no warranty of accuracy.
 */
export const nycParksEventsSource: SourceDefinition<EventList> = {
  id: 'nyc-parks-events',
  title: 'NYC Parks public events',
  provider: 'NYC Department of Parks and Recreation (NYC Open Data)',
  licence: {
    name: 'NYC.gov terms of use; NYC Open Data, free to use',
    url: NYC_PARKS_TERMS_URL,
    attribution: 'NYC Parks Public Events – Upcoming 14 Days (NYC Open Data)',
  },
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: 3 * HOUR },
  freshness: {
    degradedAfterMs: 28 * HOUR,
    staleAfterMs: 50 * HOUR,
    unavailableAfterMs: 72 * HOUR,
  },
  limits: { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: eventListSchema,
  request() {
    return { url: `${ENDPOINT}?${socrataQuery()}`, headers: { accept: 'application/json' } };
  },
  parse(body, { receivedAt }) {
    return parseParks(body, receivedAt);
  },
  check(data, previous) {
    return previous === undefined || data.events.length * 2 >= previous.events.length
      ? []
      : [
          `coverage-drop: ${String(data.events.length)} events, ${String(previous.events.length)} before`,
        ];
  },
  consumers: ['live-map', 'trip-planning'],
  failures: [
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page from the portal.',
      state: 'degraded',
      remedy: 'Keep the last good events with their age; the next run tries again.',
    },
    {
      code: 'unexpected-shape',
      detection: 'Not a list of rows with :updated_at, guid and title.',
      state: 'misconfigured',
      remedy: 'The dataset changed: compare with the capture and update the reader.',
    },
    {
      code: 'empty',
      detection: 'An empty list: a load failed or a replica is behind.',
      state: 'degraded',
      remedy: 'Keep the last good events ageing; an empty list never means "no events".',
    },
    {
      code: 'coverage-drop',
      detection: 'Fewer than half as many events as the list served.',
      state: 'degraded',
      remedy: 'Keep the fuller list while it is fresh; look at the dataset in the panel.',
    },
    ...httpFailures('NYC Open Data', 'https://data.cityofnewyork.us/'),
  ],
};
