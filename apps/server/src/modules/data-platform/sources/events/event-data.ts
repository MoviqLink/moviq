import {
  eventCategorySchema,
  eventStatusSchema,
  eventVenueSchema,
  instantSchema,
  officialUrlSchema,
  toInstant,
  type EventVenue,
} from '@moviq/contracts';
import { z } from 'zod';

/**
 * Why an event the provider lists is not served:
 * - `no-start-time`: no date and time of start, or a time to be announced;
 * - `no-venue`: no venue with coordinates;
 * - `outside-area`: a venue outside the New York area MovIQ plans in;
 * - `no-official-link`: no page of the event at the source;
 * - `long-running`: an exhibition or admission open for days, not an event to arrive on time to;
 * - `test-event`: an entry the provider marks as a test;
 * - `unreadable`: an entry whose fields do not have the documented form.
 */
const exclusionReasonSchema = z.enum([
  'no-start-time',
  'no-venue',
  'outside-area',
  'no-official-link',
  'long-running',
  'test-event',
  'unreadable',
]);

export type EventExclusion = z.infer<typeof exclusionReasonSchema>;

/** One event as its source lists it, with nothing completed that the source does not give. */
const sourceEventSchema = z.object({
  /** The provider's own stable id. */
  id: z.string().min(1),
  name: z.string().min(1),
  category: eventCategorySchema,
  /** The provider's own categories, in its words, for the panel and the credits. */
  sourceCategories: z.array(z.string().min(1)),
  status: eventStatusSchema,
  startsAt: instantSchema,
  endsAt: instantSchema.nullable(),
  venue: eventVenueSchema,
  officialUrl: officialUrlSchema,
});

export type SourceEvent = z.infer<typeof sourceEventSchema>;

export const eventListSchema = z.object({
  events: z.array(sourceEventSchema),
  /** Events the provider listed and MovIQ left out, by reason. */
  excluded: z.array(
    z.object({ reason: exclusionReasonSchema, count: z.number().int().positive() }),
  ),
  /** How many events the provider says match the request, when it says; null otherwise. */
  providerTotal: z.number().int().nonnegative().nullable(),
  /** False when the provider holds more events than this answer handed over. */
  complete: z.boolean(),
});

export type EventList = z.infer<typeof eventListSchema>;

/** Counts the events left out, by reason, in the order first met. */
export function createExclusionTally(): {
  add(reason: EventExclusion): void;
  readonly counts: EventList['excluded'];
} {
  const counts = new Map<EventExclusion, number>();
  return {
    add(reason) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    },
    get counts() {
      return [...counts].map(([reason, count]) => ({ reason, count }));
    },
  };
}

/**
 * The venue with the name and coordinates the source gives, or why there is none: no name or
 * coordinates (`no-venue`), or coordinates outside the area of `eventVenueSchema`.
 */
export function venueOf(
  name: string | undefined,
  address: string | null,
  lat: number | undefined,
  lon: number | undefined,
): EventVenue | EventExclusion {
  const named = name?.trim();
  if (named === undefined || named === '' || lat === undefined || lon === undefined) {
    return 'no-venue';
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'no-venue';
  const street = address?.trim() ?? '';
  const venue = eventVenueSchema.safeParse({
    name: named,
    address: street === '' ? null : street,
    lat,
    lon,
  });
  return venue.success ? venue.data : 'outside-area';
}

/** A web address of the event, or undefined when the text is not one. */
export function officialUrlOf(value: string | undefined): string | undefined {
  const parsed = officialUrlSchema.safeParse(value?.trim());
  return parsed.success ? parsed.data : undefined;
}

/** More than this between start and end, or since the start, is an exhibition, not an event. */
const LONG_RUNNING_MS = 24 * 60 * 60_000;

/**
 * The start and end of an event, or why it is not one to arrive on time to. An end that is not
 * after the start is dropped, never corrected.
 */
export function timesOf(
  startsAt: Date | undefined,
  endsAt: Date | undefined,
  receivedAt: Date,
): { readonly startsAt: string; readonly endsAt: string | null } | EventExclusion {
  if (startsAt === undefined || Number.isNaN(startsAt.getTime())) return 'no-start-time';
  const end = endsAt !== undefined && endsAt > startsAt ? endsAt : undefined;
  const started = receivedAt.getTime() - startsAt.getTime();
  const lasts = end === undefined ? 0 : end.getTime() - startsAt.getTime();
  if (started > LONG_RUNNING_MS || lasts > LONG_RUNNING_MS) return 'long-running';
  return { startsAt: toInstant(startsAt), endsAt: end === undefined ? null : toInstant(end) };
}

/** A short count for operators: `181 events, 19 left out; 200 of 247 handed over`. */
export function coverageOf(list: EventList): string {
  const left = list.excluded.reduce((total, entry) => total + entry.count, 0);
  const base = `${String(list.events.length)} events, ${String(left)} left out`;
  if (list.complete || list.providerTotal === null) return base;
  const handed = list.events.length + left;
  return `${base}; ${String(handed)} of ${String(list.providerTotal)} handed over`;
}
