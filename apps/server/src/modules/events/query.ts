import {
  boundingBoxSchema,
  eventCategorySchema,
  instantSchema,
  type BoundingBox,
  type EventCategory,
  type MovIqEvent,
} from '@moviq/contracts';

const DAY_MS = 24 * 60 * 60_000;
/** Without `to`, a week from `from`: today, tonight and the coming weekend. */
const DEFAULT_SPAN_MS = 7 * DAY_MS;
/** The furthest the sources reach: Ticketmaster seven days, NYC Parks fourteen. */
const MAX_SPAN_MS = 15 * DAY_MS;

export interface EventQuery {
  readonly from: Date;
  readonly to: Date;
  readonly bbox: BoundingBox | null;
  readonly categories: readonly EventCategory[];
}

export interface RawQuery {
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly bbox: string | undefined;
  readonly category: string | undefined;
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function instantOf(text: string | undefined, fallback: Date): Date | undefined {
  if (text === undefined) return fallback;
  return instantSchema.safeParse(text).success ? new Date(text) : undefined;
}

/**
 * `from` and `to` as instants (`2026-11-11T17:00:00.000Z`), `bbox` as `west,south,east,north`
 * and `category` as a comma list of MovIQ's categories; each one optional.
 */
export function parseEventQuery(raw: RawQuery, now: Date): Parsed<EventQuery> {
  const from = instantOf(raw.from, now);
  if (from === undefined) return { ok: false, message: 'from must be an instant in UTC.' };
  const to = instantOf(raw.to, new Date(from.getTime() + DEFAULT_SPAN_MS));
  if (to === undefined) return { ok: false, message: 'to must be an instant in UTC.' };
  if (to <= from || to.getTime() - from.getTime() > MAX_SPAN_MS) {
    return { ok: false, message: 'to must be after from, and at most 15 days later.' };
  }
  let bbox: BoundingBox | null = null;
  if (raw.bbox !== undefined) {
    const box = boundingBoxSchema.safeParse(raw.bbox.split(',').map(Number));
    if (!box.success) return { ok: false, message: 'bbox must be west,south,east,north.' };
    bbox = box.data;
  }
  const words = raw.category === undefined || raw.category === '' ? [] : raw.category.split(',');
  const categories = eventCategorySchema.array().safeParse(words);
  if (!categories.success) return { ok: false, message: 'category must name event categories.' };
  return { ok: true, value: { from, to, bbox, categories: [...new Set(categories.data)] } };
}

/**
 * An event still to come or under way within the query. Without an end it is shown only until it
 * starts: whether it is still on is not known, and is never assumed.
 */
export function withinQuery(event: MovIqEvent, query: EventQuery): boolean {
  const start = Date.parse(event.startsAt);
  const notOver =
    event.endsAt === null
      ? start >= query.from.getTime()
      : Date.parse(event.endsAt) > query.from.getTime();
  if (!notOver || start >= query.to.getTime()) return false;
  if (query.categories.length > 0 && !query.categories.includes(event.category)) return false;
  const box = query.bbox;
  if (box === null) return true;
  const { lat, lon } = event.venue;
  return lon >= box[0] && lat >= box[1] && lon <= box[2] && lat <= box[3];
}
