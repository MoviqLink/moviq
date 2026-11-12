import {
  toInstant,
  type EventSource,
  type EventsResponse,
  type MovIqEvent,
} from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { SourceReader } from '../data-platform/reader.js';
import { defaultEventFamilies, type EventFamily, type FamilyReading } from './families.js';
import { mergeListings } from './merge.js';
import { withinQuery, type EventQuery } from './query.js';

export interface EventCatalogDependencies {
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** The families read, in order of preference; `defaultEventFamilies()` when absent. */
  readonly families?: readonly EventFamily[];
}

export interface EventCatalog {
  list(query: EventQuery): Promise<EventsResponse>;
}

/** A family as the answer cites it, with how many of the events shown it lists. */
function sourceOf(
  family: EventFamily,
  reading: FamilyReading,
  events: readonly MovIqEvent[],
): EventSource {
  const ids = new Set(reading.provenance.map((provenance) => provenance.sourceId));
  const count = events.reduce(
    (total, event) => total + event.listings.filter((listing) => ids.has(listing.sourceId)).length,
    0,
  );
  return {
    id: family.id,
    title: family.title,
    attribution: family.attribution,
    termsUrl: family.termsUrl,
    provenance: [...reading.provenance],
    served: reading.served,
    complete: reading.complete,
    count,
  };
}

/**
 * The events of New York from every family of sources, read through the data platform: merged by
 * the one rule of `merge.ts`, cut to the query, each with its listings and every family with the
 * state of its files, so a missing provider is said, never hidden.
 */
export function createEventCatalog(deps: EventCatalogDependencies): EventCatalog {
  const families = deps.families ?? defaultEventFamilies();
  const order = families.map((family) => family.id);
  return {
    async list(query) {
      const read = await Promise.all(
        families.map(async (family) => ({ family, reading: await family.read(deps.reader) })),
      );
      const listings = read.flatMap(({ reading }) => reading.listings);
      const events = mergeListings(listings, order).filter((event) => withinQuery(event, query));
      return {
        generatedAt: toInstant(deps.clock.now()),
        from: toInstant(query.from),
        to: toInstant(query.to),
        bbox: query.bbox,
        categories: [...query.categories],
        events,
        sources: read.map(({ family, reading }) => sourceOf(family, reading, events)),
      };
    },
  };
}
