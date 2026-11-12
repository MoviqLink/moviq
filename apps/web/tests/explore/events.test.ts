import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { eventsResponseSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  categoriesIn,
  layerStatus,
  listingAgeSeconds,
  missingSources,
  ofCategory,
  sourceOfListing,
} from '../../src/features/explore/events/model/layer';
import { planHref } from '../../src/features/explore/events/model/plan-link';
import { rangeWindow } from '../../src/features/explore/events/model/range';
import { eventsEn } from '../../src/features/explore/events/texts-en';
import { eventsEs } from '../../src/features/explore/events/texts-es';
import { eventFeatures } from '../../src/features/explore/map/events-layer';

/** `GET /api/events` at 10:00 on 11/11/2026 in New York, built by the server from real captures. */
const answer = eventsResponseSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/events.json', import.meta.url)), 'utf8'),
  ),
);

const at = (instant: string) => new Date(instant);

describe('the times of the events layer, in New York time', () => {
  it('runs today until 05:00, so a night out after midnight still counts', () => {
    // 10:00 on Wednesday 11/11/2026.
    expect(rangeWindow('today', at('2026-11-11T15:00:00Z'))).toEqual({
      from: at('2026-11-11T15:00:00Z'),
      to: at('2026-11-12T10:00:00Z'),
    });
    // 01:00 on Thursday is still Wednesday night.
    expect(rangeWindow('tonight', at('2026-11-12T06:00:00Z'))).toEqual({
      from: at('2026-11-12T06:00:00Z'),
      to: at('2026-11-12T10:00:00Z'),
    });
  });

  it('starts tonight at 17:00, or now when the night has begun', () => {
    expect(rangeWindow('tonight', at('2026-11-11T15:00:00Z')).from).toEqual(
      at('2026-11-11T22:00:00Z'),
    );
    expect(rangeWindow('tonight', at('2026-11-12T01:30:00Z')).from).toEqual(
      at('2026-11-12T01:30:00Z'),
    );
  });

  it('takes this weekend from Friday 17:00 to Monday 05:00, or what is left of it', () => {
    const wednesday = rangeWindow('weekend', at('2026-11-11T15:00:00Z'));
    expect(wednesday).toEqual({ from: at('2026-11-13T22:00:00Z'), to: at('2026-11-16T10:00:00Z') });
    const saturday = rangeWindow('weekend', at('2026-11-14T18:00:00Z'));
    expect(saturday).toEqual({ from: at('2026-11-14T18:00:00Z'), to: at('2026-11-16T10:00:00Z') });
    // 03:00 on Monday is still Sunday night.
    expect(rangeWindow('weekend', at('2026-11-16T08:00:00Z')).to).toEqual(
      at('2026-11-16T10:00:00Z'),
    );
  });

  it('keeps 17:00 and 05:00 across the change of the clocks', () => {
    // Friday 30/10/2026; clocks go back at 02:00 on Sunday 01/11.
    expect(rangeWindow('weekend', at('2026-10-30T14:00:00Z'))).toEqual({
      from: at('2026-10-30T21:00:00Z'),
      to: at('2026-11-02T10:00:00Z'),
    });
  });
});

describe('the events layer over a real answer', () => {
  it('says which providers are missing or incomplete, by name', () => {
    expect(missingSources(answer).map((source) => source.title)).toEqual([
      'Ticketmaster Discovery API',
    ]);
    expect(layerStatus(answer)).toBe('degraded');
    const none = {
      ...answer,
      sources: answer.sources.map((source) => ({ ...source, served: false })),
    };
    expect(layerStatus(none)).toBe('unavailable');
  });

  it('offers only the categories present, in a fixed order, and filters by one', () => {
    const present = categoriesIn(answer.events);
    expect(present).toEqual(['music', 'sports', 'arts', 'family', 'outdoors', 'other']);
    expect(ofCategory(answer.events, 'music').every((event) => event.category === 'music')).toBe(
      true,
    );
    expect(ofCategory(answer.events, null)).toHaveLength(answer.events.length);
  });

  it('cites every listing by its source with its own age', () => {
    const merged = answer.events.find((event) => event.listings.length === 2);
    expect(
      merged?.listings.map((listing) => sourceOfListing(answer, listing.sourceId)?.id),
    ).toEqual(['ticketmaster', 'irving-plaza']);
    const first = merged?.listings[0];
    expect(
      first === undefined
        ? null
        : listingAgeSeconds(first.dataTime, Date.parse(answer.generatedAt)),
    ).toBe(37_180);
  });

  it('plans with Sara towards the venue, to be there by the start', () => {
    const knicks = answer.events.find((event) => event.name.startsWith('Home team vs. visitors'));
    if (knicks === undefined) throw new Error('No basketball game');
    const href = planHref(knicks);
    expect(href.startsWith('#/plan?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(href.slice('#/plan?'.length)))).toEqual({
      to: 'Madison Square Garden',
      lat: '40.7497062',
      lon: '-73.9916006',
      arriveBy: '2026-11-12T00:00:00.000Z',
      event: knicks.id,
    });
  });

  it('draws a called-off event grey and the selected one larger', () => {
    const features = eventFeatures(answer.events, answer.events[0]?.id ?? null).features;
    expect(features).toHaveLength(answer.events.length);
    expect(features[0]?.properties.selected).toBe(1);
    const off = answer.events
      .filter((event) => event.status !== 'scheduled')
      .map((event) => event.id);
    expect(off.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.off).toBe(off.includes(feature.properties.id) ? 1 : 0);
    }
  });
});

describe('the words of the events layer', () => {
  const shape = (value: unknown): unknown =>
    typeof value === 'object' && value !== null
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
      : typeof value;

  it('has the same keys in English and Spanish', () => {
    expect(shape(eventsEs)).toEqual(shape(eventsEn));
  });

  it('never sells, books or gives away a ticket', () => {
    const words = JSON.stringify([eventsEn, eventsEs]);
    expect(words).not.toMatch(/PayPal|bought|reserved|booked|free|comprad|reservad|gratis/i);
  });
});
