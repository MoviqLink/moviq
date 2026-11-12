import type { Provenance } from '@moviq/contracts';

import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReader } from '../data-platform/reader.js';
import {
  LIVE_NATION_TERMS_URL,
  NYC_PARKS_TERMS_URL,
  TICKETMASTER_TERMS_URL,
  brooklynParamountEventsSource,
  irvingPlazaEventsSource,
  nycParksEventsSource,
  ticketmasterSources,
  type EventList,
  type SourceEvent,
} from '../data-platform/sources/events/index.js';

/** One event as one source lists it, with the source and the time of its data. */
export interface Listing {
  readonly familyId: string;
  readonly sourceId: string;
  readonly dataTime: string;
  readonly event: SourceEvent;
}

/** What a family of sources serves now: its listings and the state of every file read. */
export interface FamilyReading {
  readonly listings: readonly Listing[];
  readonly provenance: readonly Provenance[];
  /** True when at least one file has usable data. */
  readonly served: boolean;
  /** False when a file has no usable data or the provider holds more than it handed over. */
  readonly complete: boolean;
}

/**
 * A provider of events and how to read it. Every family turns its sources into `SourceEvent`s
 * with a venue that has coordinates and an official page; a new kind of source joins as one more
 * family with its own `read`.
 */
export interface EventFamily {
  readonly id: string;
  readonly title: string;
  readonly attribution: string;
  readonly termsUrl: string;
  read(reader: SourceReader): Promise<FamilyReading>;
}

interface FamilyIdentity {
  readonly id: string;
  readonly title: string;
  readonly attribution: string;
  readonly termsUrl: string;
}

/** A family whose sources already serve `EventList`s, read together. */
function eventListFamily(
  identity: FamilyIdentity,
  definitions: readonly SourceDefinition<EventList>[],
): EventFamily {
  return {
    ...identity,
    async read(reader) {
      const readings = await Promise.all(definitions.map((definition) => reader.read(definition)));
      const listings: Listing[] = [];
      let complete = true;
      let served = false;
      for (const reading of readings) {
        const { data, provenance } = reading;
        if (data === undefined || provenance.dataTime === null) {
          complete = false;
          continue;
        }
        served = true;
        if (!data.complete) complete = false;
        for (const event of data.events) {
          listings.push({
            familyId: identity.id,
            sourceId: provenance.sourceId,
            dataTime: provenance.dataTime,
            event,
          });
        }
      }
      const provenance = readings.map((reading) => reading.provenance);
      return { listings, provenance, served, complete };
    },
  };
}

function venueFamily(definition: SourceDefinition<EventList>, id: string): EventFamily {
  return eventListFamily(
    {
      id,
      title: definition.title,
      attribution: definition.licence.attribution,
      termsUrl: LIVE_NATION_TERMS_URL,
    },
    [definition],
  );
}

/** In order of preference: the first family of a merged event gives its words and its link. */
export function defaultEventFamilies(): readonly EventFamily[] {
  return [
    eventListFamily(
      {
        id: 'ticketmaster',
        title: 'Ticketmaster Discovery API',
        attribution: 'Event data from the Ticketmaster Discovery API',
        termsUrl: TICKETMASTER_TERMS_URL,
      },
      ticketmasterSources,
    ),
    venueFamily(irvingPlazaEventsSource, 'irving-plaza'),
    venueFamily(brooklynParamountEventsSource, 'brooklyn-paramount'),
    eventListFamily(
      {
        id: 'nyc-parks-events',
        title: nycParksEventsSource.title,
        attribution: nycParksEventsSource.licence.attribution,
        termsUrl: NYC_PARKS_TERMS_URL,
      },
      [nycParksEventsSource],
    ),
  ];
}
