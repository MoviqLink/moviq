import { describe, expect, it } from 'vitest';

import type { SourceEvent } from '../../src/modules/data-platform/sources/events/index.js';
import { parseJsonLdEvents } from '../../src/modules/data-platform/sources/events/json-ld.js';
import { parseEventSearch } from '../../src/modules/data-platform/sources/events/ticketmaster.js';
import type { Listing } from '../../src/modules/events/families.js';
import { mergeListings } from '../../src/modules/events/merge.js';
import { admitted, capture, RECEIVED } from '../sources/events/fixtures.js';

const FAMILIES = ['ticketmaster', 'irving-plaza', 'brooklyn-paramount', 'nyc-parks-events'];

const listingsOf = (
  familyId: string,
  sourceId: string,
  events: readonly SourceEvent[],
): Listing[] =>
  events.map((event) => ({ familyId, sourceId, dataTime: '2026-11-11T04:40:20.000Z', event }));

const ticketmaster = admitted(
  parseEventSearch(capture('ticketmaster-events.json'), RECEIVED.ticketmaster),
).events;
const irving = admitted(
  parseJsonLdEvents(capture('irving-plaza-shows.html'), RECEIVED.venues),
).events;
const paramount = admitted(
  parseJsonLdEvents(capture('brooklyn-paramount-shows.html'), RECEIVED.venues),
).events;

const byId = (events: readonly SourceEvent[], id: string): SourceEvent => {
  const event = events.find((candidate) => candidate.id === id);
  if (event === undefined) throw new Error(`No event ${id}`);
  return event;
};

describe('One event once, by the same venue and start', () => {
  it('merges a concert listed by Ticketmaster and by the venue, Ticketmaster first', () => {
    const merged = mergeListings(
      [
        ...listingsOf('ticketmaster', 'ticketmaster-events-01', ticketmaster),
        ...listingsOf('irving-plaza', 'irving-plaza-events', irving),
        ...listingsOf('brooklyn-paramount', 'brooklyn-paramount-events', paramount),
      ],
      FAMILIES,
    );
    const ax = merged.filter((event) => event.name.startsWith('Test Band: Late Show'));
    expect(ax).toHaveLength(1);
    expect(ax[0]?.id).toBe('ticketmaster:tm-test-09');
    expect(ax[0]?.listings.map((listing) => listing.sourceId)).toEqual([
      'ticketmaster-events-01',
      'irving-plaza-events',
    ]);
    const sting = merged.filter(
      (event) => event.name === 'Test Singer Tour' && event.startsAt === '2026-11-12T00:00:00.000Z',
    );
    expect(sting.map((event) => event.listings.length)).toEqual([2]);
    expect(merged).toHaveLength(ticketmaster.length + irving.length + paramount.length - 2);
  });

  it('keeps apart two events at the same place an hour apart, or across the street', () => {
    const knicks = byId(ticketmaster, 'tm-test-08');
    const later = { ...knicks, id: 'p-1', startsAt: '2026-11-12T01:00:00.000Z' };
    // 0.002 degrees of latitude is about 220 m.
    const across = {
      ...knicks,
      id: 'p-2',
      venue: { ...knicks.venue, lat: knicks.venue.lat + 0.002 },
    };
    const merged = mergeListings(
      [
        ...listingsOf('ticketmaster', 'ticketmaster-events-01', [knicks]),
        ...listingsOf('nyc-parks-events', 'nyc-parks-events', [later, across]),
      ],
      FAMILIES,
    );
    expect(merged).toHaveLength(3);
  });

  it('never merges by a similar name, nor when the match is not one to one', () => {
    const ax = byId(ticketmaster, 'tm-test-09');
    const twin = { ...ax, id: 'twin', name: 'VIP upgrade' };
    const [venue] = irving;
    if (venue === undefined) throw new Error('No Irving Plaza event');
    const merged = mergeListings(
      [
        ...listingsOf('ticketmaster', 'ticketmaster-events-01', [ax, twin]),
        ...listingsOf('irving-plaza', 'irving-plaza-events', [venue]),
      ],
      FAMILIES,
    );
    expect(merged.every((event) => event.listings.length === 1)).toBe(true);
  });

  it('keeps one copy of an event two windows of a provider list, the newest', () => {
    const knicks = byId(ticketmaster, 'tm-test-08');
    const [older] = listingsOf('ticketmaster', 'ticketmaster-events-01', [knicks]);
    if (older === undefined) throw new Error('No listing');
    const newer = listingsOf('ticketmaster', 'ticketmaster-events-02', [knicks]);
    const merged = mergeListings(
      [{ ...older, dataTime: '2026-11-11T01:00:00.000Z' }, ...newer],
      FAMILIES,
    );
    expect(merged.map((event) => event.listings.map((listing) => listing.sourceId))).toEqual([
      ['ticketmaster-events-02'],
    ]);
  });

  it('never chains two events of one provider into one', () => {
    const knicks = byId(ticketmaster, 'tm-test-08');
    const near = (id: string, dLat: number): SourceEvent => ({
      ...knicks,
      id,
      venue: { ...knicks.venue, lat: knicks.venue.lat + dLat },
    });
    // a (Ticketmaster) ~ b (venue) ~ c (Parks) ~ d (Ticketmaster), each pair 80 m apart.
    const merged = mergeListings(
      [
        ...listingsOf('ticketmaster', 't', [near('a', 0), near('d', 0.0021)]),
        ...listingsOf('irving-plaza', 'i', [near('b', 0.0007)]),
        ...listingsOf('nyc-parks-events', 'p', [near('c', 0.0014)]),
      ],
      FAMILIES,
    );
    for (const event of merged) {
      const ids = event.listings.map((listing) => listing.sourceId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
