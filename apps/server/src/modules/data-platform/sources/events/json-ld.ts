import type { EventCategory, EventStatus } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult } from '../../definition.js';
import { decodeText, refuse } from '../city/parsing.js';
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

const SCRIPT = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const coordinate = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .transform(Number),
]);

const placeSchema = z.object({
  name: z.string().optional(),
  address: z
    .union([
      z.string(),
      z.object({
        streetAddress: z.string().optional(),
        addressLocality: z.string().optional(),
      }),
    ])
    .optional(),
  geo: z.object({ latitude: coordinate, longitude: coordinate }).optional(),
});

/** A schema.org `Event` (or a subtype) with the fields MovIQ reads. */
const eventNodeSchema = z.object({
  '@type': z.union([z.string(), z.array(z.string())]),
  name: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  url: z.string().optional(),
  eventStatus: z.string().optional(),
  location: z.union([placeSchema, z.array(placeSchema)]).optional(),
});

type EventNode = z.infer<typeof eventNodeSchema>;

/** A date with its time and offset; a date alone, or a time without zone, is not a start. */
const zonedSchema = z.iso.datetime({ offset: true });

const TYPES: Readonly<Record<string, EventCategory>> = {
  MusicEvent: 'music',
  SportsEvent: 'sports',
  TheaterEvent: 'arts',
  DanceEvent: 'arts',
  ComedyEvent: 'arts',
  ScreeningEvent: 'arts',
  VisualArtsEvent: 'arts',
  LiteraryEvent: 'arts',
  ChildrensEvent: 'family',
  FoodEvent: 'food',
  Festival: 'festival',
};

const STATUS: Readonly<Record<string, EventStatus>> = {
  EventScheduled: 'scheduled',
  EventRescheduled: 'rescheduled',
  EventPostponed: 'postponed',
  EventCancelled: 'cancelled',
};

const typesOf = (node: EventNode): string[] =>
  Array.isArray(node['@type']) ? node['@type'] : [node['@type']];

const isEventType = (type: unknown): boolean =>
  typeof type === 'string' && /Event$|^Festival$/.test(type);

/** Every node typed as an event, wherever it sits: a list, an `@graph` or an `ItemList`. */
function collectEvents(node: unknown, found: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, found);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const type: unknown = '@type' in node ? node['@type'] : undefined;
  if ((Array.isArray(type) ? type : [type]).some(isEventType)) {
    found.push(node);
    return;
  }
  for (const value of Object.values(node)) collectEvents(value, found);
}

/**
 * Live Nation's sites date an event with no announced time at 00:00:01 (Irving Plaza, 26/01/2027,
 * seen on 11/11/2026): that second is a placeholder, not a start.
 */
const PLACEHOLDER_TIME = /T00:00:01(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instantOf(text: string | undefined): Date | undefined {
  if (text === undefined || !zonedSchema.safeParse(text).success || PLACEHOLDER_TIME.test(text)) {
    return undefined;
  }
  return new Date(text);
}

function addressOf(place: z.infer<typeof placeSchema> | undefined): string | null {
  const address = place?.address;
  if (address === undefined) return null;
  if (typeof address === 'string') return address;
  const parts = [address.streetAddress, address.addressLocality].map((part) => part?.trim());
  const given = parts.filter((part): part is string => part !== undefined && part !== '');
  return given.length === 0 ? null : given.join(', ');
}

function normalise(node: EventNode, receivedAt: Date): SourceEvent | EventExclusion {
  const status = STATUS[node.eventStatus?.split('/').pop() ?? 'EventScheduled'];
  if (status === undefined) return 'no-venue';
  const times = timesOf(instantOf(node.startDate), instantOf(node.endDate), receivedAt);
  if (typeof times === 'string') return times;
  const place = Array.isArray(node.location) ? node.location[0] : node.location;
  const venue = venueOf(place?.name, addressOf(place), place?.geo?.latitude, place?.geo?.longitude);
  if (typeof venue === 'string') return venue;
  const officialUrl = officialUrlOf(node.url);
  if (officialUrl === undefined) return 'no-official-link';
  const types = typesOf(node);
  return {
    id: officialUrl,
    name: node.name.trim(),
    category:
      types.map((type) => TYPES[type]).find((category) => category !== undefined) ?? 'other',
    sourceCategories: types,
    status,
    ...times,
    venue,
    officialUrl,
  };
}

/**
 * The events a page publishes for search engines as schema.org JSON-LD, normalised. A block that
 * is not JSON is skipped; a page with no event at all is refused, since its calendar always has
 * some. An event moved online (`EventMovedOnline`) has no venue to go to.
 */
export function parseJsonLdEvents(body: Uint8Array, receivedAt: Date): ParseResult<EventList> {
  const decoded = decodeText(body);
  if (!decoded.ok) return decoded;
  const nodes: unknown[] = [];
  for (const [, block = ''] of decoded.text.matchAll(SCRIPT)) {
    try {
      collectEvents(JSON.parse(block), nodes);
    } catch {
      continue;
    }
  }
  if (nodes.length === 0) return refuse('no-events', 'The page publishes no schema.org event.');
  const tally = createExclusionTally();
  const events: SourceEvent[] = [];
  for (const node of nodes) {
    const event = eventNodeSchema.safeParse(node);
    const shown = event.success ? normalise(event.data, receivedAt) : 'unreadable';
    if (typeof shown === 'string') tally.add(shown);
    else events.push(shown);
  }
  const data: EventList = { events, excluded: tally.counts, providerTotal: null, complete: true };
  return { ok: true, data, dataTime: receivedAt, coverage: coverageOf(data) };
}
