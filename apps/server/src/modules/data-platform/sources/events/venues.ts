import type { SourceDefinition } from '../../definition.js';
import { HOUR } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { eventListSchema, type EventList } from './event-data.js';
import { parseJsonLdEvents } from './json-ld.js';

/** The terms linked from the foot of both sites; their page answers with a browser challenge. */
export const LIVE_NATION_TERMS_URL =
  'https://help.livenation.com/hc/en-us/articles/10468828916113-Terms-of-Use';

interface Venue {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/**
 * The calendar page of a venue, read for the schema.org `MusicEvent` entries it publishes for
 * search engines: name, start with its offset, venue with address and coordinates, and the
 * official ticket page. The page has no time of its own, so the time of the data is that of
 * receipt; listings change a few times a week, so once a day is enough.
 *
 * Access: robots.txt allows everything (`User-agent: * / Allow: /`, read on 11/11/2026); one GET a
 * day with the platform's generic identity and no other header. Terms: the Live Nation terms
 * linked from the page; on 11/11/2026 their page answered our GET with a Cloudflare challenge and
 * was not read, and a challenge is never worked around. Event content belongs to the venue and
 * the organisers; MovIQ shows the name, times and venue with this credit and links to the
 * official page. No image or logo is taken.
 */
function venueSource(venue: Venue): SourceDefinition<EventList> {
  return {
    id: `${venue.id}-events`,
    title: `${venue.name} events (schema.org)`,
    provider: `${venue.name}, its own website`,
    licence: {
      name: 'Live Nation venue site terms of use',
      url: LIVE_NATION_TERMS_URL,
      attribution: `Event listings published by ${venue.name} on its website`,
    },
    kind: 'static',
    rhythm: { class: 'cold', baseIntervalMs: 24 * HOUR },
    freshness: {
      degradedAfterMs: 30 * HOUR,
      staleAfterMs: 54 * HOUR,
      unavailableAfterMs: 96 * HOUR,
    },
    limits: { timeoutMs: 30_000, maxBytes: 2 * 1024 * 1024 },
    dataTimeSource: 'receipt',
    keepVersions: 1,
    dataSchema: eventListSchema,
    request() {
      return { url: venue.url, headers: { accept: 'text/html' } };
    },
    parse(body, { receivedAt }) {
      return parseJsonLdEvents(body, receivedAt);
    },
    consumers: ['live-map', 'trip-planning'],
    failures: [
      {
        code: 'not-text',
        detection: 'The page is not UTF-8 text.',
        state: 'degraded',
        remedy: 'Keep the last good events with their age; the next run tries again.',
      },
      {
        code: 'no-events',
        detection: 'No schema.org event on the page: a redesign, or a challenge page.',
        state: 'degraded',
        remedy:
          'Keep the last events ageing; an operator opens the page and, if it is a challenge, retires the source.',
      },
      ...httpFailures(venue.name, venue.url),
    ],
  };
}

export const irvingPlazaEventsSource = venueSource({
  id: 'irving-plaza',
  name: 'Irving Plaza',
  url: 'https://www.irvingplaza.com/shows',
});

export const brooklynParamountEventsSource = venueSource({
  id: 'brooklyn-paramount',
  name: 'Brooklyn Paramount',
  url: 'https://www.brooklynparamount.com/shows',
});
