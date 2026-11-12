import { describe, expect, it } from 'vitest';

import { eventListSchema } from '../../../src/modules/data-platform/sources/events/event-data.js';
import { parseJsonLdEvents } from '../../../src/modules/data-platform/sources/events/json-ld.js';
import {
  brooklynParamountEventsSource,
  irvingPlazaEventsSource,
} from '../../../src/modules/data-platform/sources/events/venues.js';
import { admitted, bytes, capture, codeOf, RECEIVED } from './fixtures.js';

const parse = (body: Uint8Array) => parseJsonLdEvents(body, RECEIVED.venues);

/** The official page of the first concert of the Irving Plaza page written for the tests. */
const AX_PAGE = 'https://www.ticketmaster.com/test-band-late-show-tour-2026-11-11/event/TESTIR01';

const page = (...nodes: readonly unknown[]) =>
  bytes(
    nodes
      .map((node) => `<script type="application/ld+json">${JSON.stringify(node)}</script>`)
      .join('\n'),
  );

const concert = {
  '@context': 'https://schema.org',
  '@type': 'MusicEvent',
  name: 'A concert',
  startDate: '2026-11-20T19:00:00-05:00',
  url: 'https://www.ticketmaster.com/event/X',
  eventStatus: 'https://schema.org/EventScheduled',
  location: {
    '@type': 'Place',
    name: 'Irving Plaza',
    address: { streetAddress: '17 Irving Place', addressLocality: 'New York' },
    geo: { latitude: 40.734917, longitude: -73.9884469 },
  },
};

describe('Venue calendars as schema.org JSON-LD', () => {
  it('reads Irving Plaza and leaves out the placeholder time of 00:00:01', () => {
    const data = admitted(parse(capture('irving-plaza-shows.html')));
    expect(data.events).toHaveLength(6);
    expect(data.excluded).toEqual([{ reason: 'no-start-time', count: 1 }]);
    expect(data.events[0]).toEqual({
      id: AX_PAGE,
      name: 'Test Band: Late Show Tour',
      category: 'music',
      sourceCategories: ['MusicEvent'],
      status: 'scheduled',
      startsAt: '2026-11-12T00:00:00.000Z',
      endsAt: null,
      venue: {
        name: 'Irving Plaza Powered By Verizon 5G',
        address: '17 Irving Place, New York',
        lat: 40.734917,
        lon: -73.9884469,
      },
      officialUrl: AX_PAGE,
    });
    expect(eventListSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('reads Brooklyn Paramount, dated by receipt', () => {
    const result = parse(capture('brooklyn-paramount-shows.html'));
    expect(result).toMatchObject({
      ok: true,
      dataTime: RECEIVED.venues,
      coverage: '6 events, 0 left out',
    });
  });

  it('takes the status schema.org gives, and no venue for an event moved online', () => {
    const data = admitted(
      parse(
        page(
          { ...concert, eventStatus: 'https://schema.org/EventCancelled' },
          { ...concert, eventStatus: 'https://schema.org/EventPostponed' },
          { ...concert, eventStatus: 'https://schema.org/EventMovedOnline' },
        ),
      ),
    );
    expect(data.events.map((event) => event.status)).toEqual(['cancelled', 'postponed']);
    expect(data.excluded).toEqual([{ reason: 'no-venue', count: 1 }]);
  });

  it('never takes a date without time, or a time without zone, as a start', () => {
    const data = admitted(
      parse(
        page(
          { ...concert, startDate: '2026-11-20' },
          { ...concert, startDate: '2026-11-20T19:00:00' },
          { ...concert, endDate: '2026-11-20T18:00:00-05:00' },
        ),
      ),
    );
    expect(data.excluded).toEqual([{ reason: 'no-start-time', count: 2 }]);
    expect(data.events[0]?.endsAt).toBeNull();
  });

  it('finds events in a graph or a list and skips a block that is not JSON', () => {
    const body = bytes(
      [
        '<script type="application/ld+json">{ not json</script>',
        `<script type="application/ld+json">${JSON.stringify({ '@graph': [concert] })}</script>`,
        `<script type='application/ld+json'>${JSON.stringify({
          '@type': 'ItemList',
          itemListElement: [
            { '@type': 'ListItem', item: { ...concert, url: 'https://a.example/b' } },
          ],
        })}</script>`,
      ].join('\n'),
    );
    expect(admitted(parse(body)).events).toHaveLength(2);
  });

  it('refuses a page with no event, such as a challenge page', () => {
    expect(codeOf(parse(bytes('<html><title>Just a moment...</title></html>')))).toBe('no-events');
  });

  it('asks each venue once a day for its calendar page', () => {
    for (const source of [irvingPlazaEventsSource, brooklynParamountEventsSource]) {
      expect(source.rhythm.baseIntervalMs).toBe(86_400_000);
      expect(source.request({ credentials: {}, now: RECEIVED.venues })).toEqual({
        url:
          source === irvingPlazaEventsSource
            ? 'https://www.irvingplaza.com/shows'
            : 'https://www.brooklynparamount.com/shows',
        headers: { accept: 'text/html' },
      });
      expect(source.failures.map((failure) => failure.code).slice(0, 2)).toEqual([
        'not-text',
        'no-events',
      ]);
    }
  });
});
