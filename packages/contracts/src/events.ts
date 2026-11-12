import { z } from 'zod';

import { boundingBoxSchema } from './live.js';
import { provenanceSchema } from './sources.js';
import { instantSchema } from './time.js';

/**
 * MovIQ's kinds of event, each one mapped from the categories its source gives and never guessed
 * from the words of a title. What a source does not classify is `other`.
 */
export const eventCategorySchema = z.enum([
  'music',
  'sports',
  'arts',
  'family',
  'fitness',
  'outdoors',
  'community',
  'food',
  'festival',
  'other',
]);

export type EventCategory = z.infer<typeof eventCategorySchema>;

/** As the source states it: a moved or cancelled event says so, nothing else is assumed. */
export const eventStatusSchema = z.enum(['scheduled', 'rescheduled', 'postponed', 'cancelled']);

export type EventStatus = z.infer<typeof eventStatusSchema>;

const text = z.string().min(1);

/** The New York area MovIQ plans in, the same box as a place of a trip. */
export const eventVenueSchema = z.object({
  name: text,
  /** Street address as the source writes it; null when it gives none. */
  address: text.nullable(),
  lat: z.number().min(40.4).max(41.1),
  lon: z.number().min(-74.4).max(-73.6),
});

export type EventVenue = z.infer<typeof eventVenueSchema>;

/** Only web addresses: an official page is opened in a new tab, never a script or a file. */
export const officialUrlSchema = z.url({ protocol: /^https?$/ });

/** Where an event is listed: the source, its id there, its official page and the time of the data. */
export const eventListingSchema = z.object({
  sourceId: text,
  eventId: text,
  officialUrl: officialUrlSchema,
  /** The time of the data of the listing's source, which its age is measured from. */
  dataTime: instantSchema,
});

export type EventListing = z.infer<typeof eventListingSchema>;

export const eventSchema = z
  .object({
    /** `<provider>:<id there>` of its first listing, such as `ticketmaster:vvG1…`: stable. */
    id: text,
    name: text,
    category: eventCategorySchema,
    status: eventStatusSchema,
    startsAt: instantSchema,
    /** Null when the source gives no end, or only an approximate one. */
    endsAt: instantSchema.nullable(),
    venue: eventVenueSchema,
    /**
     * The first listing gives the words and the link shown. More than one only when two sources
     * list the same venue at the same start: the one rule events are merged by.
     */
    listings: z.array(eventListingSchema).min(1),
  })
  .refine(
    (event) => event.endsAt === null || Date.parse(event.endsAt) > Date.parse(event.startsAt),
    'An event ends after it starts',
  );

export type MovIqEvent = z.infer<typeof eventSchema>;

/**
 * A provider and every file of it read for the answer: Ticketmaster is read in windows of time,
 * each one a source with its own state and age.
 */
export const eventSourceSchema = z.object({
  /** The provider, the first part of the id of its events. */
  id: text,
  title: text,
  /** The credit shown wherever its events appear. */
  attribution: text,
  /** The provider's terms of use of the data. */
  termsUrl: z.url(),
  provenance: z.array(provenanceSchema).min(1),
  /** False when none of its files has usable data: its events are missing from the answer. */
  served: z.boolean(),
  /** False when a file is missing or the provider listed more events than it handed over. */
  complete: z.boolean(),
  /** Its events in the answer, before merging. */
  count: z.number().int().nonnegative(),
});

export type EventSource = z.infer<typeof eventSourceSchema>;

/** `GET /api/events`: the events that have not ended, between `from` and `to`. */
export const eventsResponseSchema = z.object({
  generatedAt: instantSchema,
  from: instantSchema,
  to: instantSchema,
  bbox: boundingBoxSchema.nullable(),
  /** The categories asked for; empty for every one. */
  categories: z.array(eventCategorySchema),
  events: z.array(eventSchema),
  sources: z.array(eventSourceSchema),
});

export type EventsResponse = z.infer<typeof eventsResponseSchema>;
