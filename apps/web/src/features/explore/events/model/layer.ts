import {
  eventCategorySchema,
  type EventCategory,
  type EventSource,
  type EventsResponse,
  type MovIqEvent,
} from '@moviq/contracts';

/** The categories present, in MovIQ's order, so the chips never offer an empty choice. */
export function categoriesIn(events: readonly MovIqEvent[]): EventCategory[] {
  const present = new Set(events.map((event) => event.category));
  return eventCategorySchema.options.filter((category) => present.has(category));
}

/** The events of one category, or all of them. */
export function ofCategory(
  events: readonly MovIqEvent[],
  category: EventCategory | null,
): MovIqEvent[] {
  return category === null ? [...events] : events.filter((event) => event.category === category);
}

/** Providers whose events are missing, wholly or in part: the layer says so by name. */
export function missingSources(answer: EventsResponse): EventSource[] {
  return answer.sources.filter((source) => !source.served || !source.complete);
}

/** The state of the layer as a mode of Explore: live, partly late, or not available. */
export function layerStatus(answer: EventsResponse): 'live' | 'degraded' | 'unavailable' {
  if (answer.sources.every((source) => !source.served)) return 'unavailable';
  const healthy = answer.sources.every(
    (source) =>
      source.served &&
      source.complete &&
      source.provenance.every((provenance) => provenance.state === 'healthy'),
  );
  return healthy ? 'live' : 'degraded';
}

/** Seconds since the data of the listing's source, never negative. */
export function listingAgeSeconds(dataTime: string, now: number): number {
  return Math.max(0, (now - Date.parse(dataTime)) / 1000);
}

/** The source behind a listing, by the id of its file. */
export function sourceOfListing(
  answer: EventsResponse | null,
  sourceId: string,
): EventSource | undefined {
  return answer?.sources.find((source) =>
    source.provenance.some((provenance) => provenance.sourceId === sourceId),
  );
}
