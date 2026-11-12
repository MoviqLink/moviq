import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import { fromNewYorkWallClockText } from '../../../../infrastructure/clock/new-york.js';
import type { ParseResult, SourceDefinition } from '../../definition.js';
import { HOUR, count } from '../mta/provider.js';
import {
  NYC_OPEN_DATA,
  coversDate,
  newYorkDate,
  newYorkDay,
  nycOpenDataLicence,
  readRows,
  socrataFailures,
} from './socrata.js';

/** A zone-less Socrata time, which NYC permits give in New York time. */
const newYorkTime = z
  .string()
  .transform((text) => fromNewYorkWallClockText(text))
  .pipe(z.date());

/** One row of "NYC Permitted Event Information" (`tvpp-9vvx`). */
const eventRow = z.object({
  event_id: z.string().min(1),
  event_name: z.string().min(1),
  start_date_time: newYorkTime,
  end_date_time: newYorkTime,
  event_agency: z.string().min(1),
  event_type: z.string().min(1),
  event_borough: z.string().min(1),
  event_location: z.string().min(1),
  event_street_side: z.string().optional(),
  street_closure_type: z.string().min(1),
});

/** One stretch of a permit, as published: the dataset lists each stretch of an event as a row. */
const stretchSchema = z.object({ startsAt: instantSchema, endsAt: instantSchema });

const eventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  /** The agency that issued the permit, such as `Street Activity Permit Office`. */
  agency: z.string().min(1),
  borough: z.string().min(1),
  /** Where, as published: often `BROADWAY between LIBERTY STREET and BATTERY PLACE`. */
  location: z.string().min(1),
  side: z.string().nullable(),
  /**
   * The closure of the permit: `Full Street Closure`, `Curb Lane Only`, `Full Sidewalk Closure`
   * and others as published; null when the permit closes nothing (`N/A`).
   */
  closure: z.string().nullable(),
  /** The start of its first stretch in force today, as published: an earlier day for a long one. */
  startsAt: instantSchema,
  /** The end of its last stretch in force today, as published: how long the permit holds. */
  endsAt: instantSchema,
  /** Its stretches in force today, earliest first; one for nearly every event. */
  stretches: z.array(stretchSchema).min(1),
});

const permittedEventsSchema = z.object({
  date: z.iso.date(),
  readAt: instantSchema,
  events: z.array(eventSchema),
  leftOut: z.number().int().nonnegative(),
});

export type PermittedEvents = z.infer<typeof permittedEventsSchema>;
type EventRow = z.infer<typeof eventRow>;
type PermittedEvent = z.infer<typeof eventSchema>;

/** 610 events on 11/11/2026, a Wednesday. */
const MINIMUM_EVENTS = 100;

/** A row in force at some moment of the New York day, not one that only touches its midnight. */
function inForce(row: EventRow, day: { readonly start: Date; readonly end: Date }): boolean {
  return row.start_date_time < day.end && row.end_date_time > day.start;
}

function toEvent(row: EventRow): PermittedEvent {
  const stretch = {
    startsAt: toInstant(row.start_date_time),
    endsAt: toInstant(row.end_date_time),
  };
  return {
    id: row.event_id,
    name: row.event_name.trim(),
    type: row.event_type,
    agency: row.event_agency,
    borough: row.event_borough,
    location: row.event_location.replace(/\s+/g, ' ').trim(),
    side: row.event_street_side ?? null,
    closure: row.street_closure_type === 'N/A' ? null : row.street_closure_type,
    ...stretch,
    stretches: [stretch],
  };
}

/** What one permit says apart from its times. */
const permitOf = (event: PermittedEvent): string =>
  JSON.stringify([
    event.name,
    event.type,
    event.agency,
    event.borough,
    event.location,
    event.side,
    event.closure,
  ]);

/**
 * One event per id with its stretches of the day in order. The same id with another name, place
 * or closure is refused: it would be two permits under one number.
 */
function onePerEvent(events: readonly PermittedEvent[]): PermittedEvent[] | string {
  const byId = new Map<string, PermittedEvent>();
  for (const event of events) {
    const seen = byId.get(event.id);
    if (seen === undefined) {
      byId.set(event.id, event);
      continue;
    }
    if (permitOf(seen) !== permitOf(event)) return event.id;
    const stretches = [...seen.stretches, ...event.stretches].sort((a, b) =>
      a.startsAt.localeCompare(b.startsAt),
    );
    const ends = stretches.map((stretch) => stretch.endsAt).sort();
    const startsAt = stretches[0]?.startsAt ?? seen.startsAt;
    byId.set(event.id, { ...seen, startsAt, endsAt: ends.at(-1) ?? seen.endsAt, stretches });
  }
  return [...byId.values()];
}

function parseEvents(body: Uint8Array, receivedAt: Date): ParseResult<PermittedEvents> {
  const read = readRows(body, eventRow);
  if (!('rows' in read)) return read;
  const date = newYorkDate(receivedAt);
  const day = newYorkDay(date);
  const events = onePerEvent(read.rows.filter((row) => inForce(row, day)).map(toEvent));
  if (typeof events === 'string') {
    return { ok: false, code: 'check-failed', detail: `event ${events} twice, with other data` };
  }
  const closing = events.filter((event) => event.closure !== null).length;
  const earlier = events.filter((event) => new Date(event.startsAt) < day.start).length;
  return {
    ok: true,
    data: { date, readAt: toInstant(receivedAt), events, leftOut: read.leftOut },
    dataTime: receivedAt,
    coverage:
      `${count(events.length, 'events')} on ${date}, ${String(closing)} with a closure, ` +
      `${String(earlier)} in force since an earlier day`,
  };
}

/**
 * Events with a City permit in force today (street fairs, parades, markets, filming, park events),
 * with the closure each permit allows, from NYC Open Data (`tvpp-9vvx`). Times are New York times
 * without zone. The dataset lists each stretch of an event as its own row (the Mount Sinai
 * Greenmarket, event 911512: one row for each Wednesday), so an event enters when one of its
 * stretches is in force at some moment of the New York day, and it keeps its stretch as published:
 * a Parks closure from 30/06/2024 to 31/12/2026 is in force today until 31/12/2026. On 11/11/2026,
 * 610 events: 51 with a closure of street, curb lane or sidewalk, 34 in force since an earlier
 * day. Asked every hour; the dataset is updated daily.
 */
export const nycPermittedEventsToday: SourceDefinition<PermittedEvents> = {
  id: 'nyc-permitted-events-today',
  title: 'NYC permitted events today',
  provider: 'NYC Street Activity Permit Office (NYC Open Data)',
  licence: nycOpenDataLicence('NYC Permitted Event Information (NYC Open Data, tvpp-9vvx)'),
  kind: 'static',
  rhythm: { class: 'cold', baseIntervalMs: HOUR },
  freshness: { degradedAfterMs: 3 * HOUR, staleAfterMs: 12 * HOUR, unavailableAfterMs: 24 * HOUR },
  limits: { timeoutMs: 60_000, maxBytes: 8 * 1024 * 1024 },
  dataTimeSource: 'receipt',
  keepVersions: 1,
  dataSchema: permittedEventsSchema,
  request({ now }) {
    const where = coversDate('start_date_time', 'end_date_time', newYorkDate(now));
    return {
      url: `${NYC_OPEN_DATA}tvpp-9vvx.json?$where=${encodeURIComponent(where)}&$order=event_id&$limit=20000`,
    };
  },
  parse(body, { receivedAt }) {
    return parseEvents(body, receivedAt);
  },
  check(data) {
    return data.events.length < MINIMUM_EVENTS
      ? [`${count(data.events.length, 'events')}, minimum ${String(MINIMUM_EVENTS)}`]
      : [];
  },
  consumers: ['live-map', 'trip-watch'],
  failures: socrataFailures(
    'data.cityofnewyork.us',
    `Fewer than ${String(MINIMUM_EVENTS)} events, or one event id twice with other data`,
  ),
};
