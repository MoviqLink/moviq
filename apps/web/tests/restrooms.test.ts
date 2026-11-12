import {
  restroomsNearResponseSchema,
  type CityItem,
  type RestroomsNearResponse,
} from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { FIRST_ON, itemTime, toneOf } from '../src/features/explore/city/model/layers';
import { cardEn } from '../src/features/explore/city/texts-card-en';
import { cardEs } from '../src/features/explore/city/texts-card-es';
import { cityEn } from '../src/features/explore/city/texts-en';
import { cityEs } from '../src/features/explore/city/texts-es';
import {
  byStop,
  hoursLine,
  restroomQuery,
  restroomStops,
} from '../src/features/trip/model/restrooms';
import { restroomEn, restroomEs } from '../src/features/trip/restroom-texts';
import { journey } from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');

const facts = {
  placeType: 'Library',
  operator: 'NYPL',
  hours: 'Sunday: Closed\nMonday: 10:00 am - 8:00 pm',
  season: 'year-round',
  access: 'full',
  stalls: 'multi-stall-gendered',
  changingTable: 'women',
  keyOrCode: true,
  note: 'Yes, a key is needed to enter',
  website: 'https://www.nypl.org/locations/parkchester',
} as const;

/** The answer of `GET /api/city/restrooms` for two stops: one restroom near the second. */
function answer(restrooms: RestroomsNearResponse['restrooms']): RestroomsNearResponse {
  return restroomsNearResponseSchema.parse({
    generatedAt: '2026-11-11T12:00:00.000Z',
    stepFree: false,
    withinMetres: 800,
    restrooms,
    source: {
      title: 'NYC public restrooms',
      attribution: 'Public Restrooms, City of New York (NYC Open Data, i7jb-7jku)',
      kind: 'static',
      publishedAt: null,
      provenance: {
        sourceId: 'nyc-public-restrooms',
        dataTime: '2026-11-11T09:00:00.000Z',
        receivedAt: '2026-11-11T09:00:00.000Z',
        ageSeconds: 10_800,
        state: 'healthy',
        evidence: 'Read by the test.',
      },
    },
  });
}

describe('restroom on the way, on the trip', () => {
  it('asks near the next stops of the trip, step-free only when the trip is', () => {
    const trip = journey(now, 'en', false);
    const stops = restroomStops(trip, now);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.length).toBeLessThanOrEqual(3);
    const query = restroomQuery(stops, false);
    expect(decodeURIComponent(query)).toMatch(
      /^near=40\.\d{5},-7\d\.\d{5}(;40\.\d{5},-7\d\.\d{5})*$/,
    );
    expect(restroomQuery(stops, true)).toMatch(/&stepFree=1$/);
    expect(restroomStops(trip, Date.parse(trip.itinerary.arriveAt) + 1)).toEqual([]);
  });

  it('groups what was found by stop, leaving out a stop with none', () => {
    const stops = restroomStops(journey(now, 'en', false), now);
    const found = answer([
      {
        name: 'Parkchester Library, NYPL',
        point: [-73.86, 40.83],
        facts,
        near: 1,
        straightMetres: 220,
      },
    ]);
    expect(byStop(found, stops)).toEqual([{ stop: stops[1]?.label, restrooms: found.restrooms }]);
    expect(byStop(answer(null), stops)).toEqual([]);
  });

  it('writes the published hours on one line, as published, and the straight line as such', () => {
    expect(hoursLine(facts.hours)).toBe('Sunday: Closed · Monday: 10:00 am - 8:00 pm');
    expect(restroomEn.straight).toBe('in a straight line');
    expect(restroomEs.straight).toBe('en línea recta');
    expect(restroomEs.title).toBe('Aseo en el camino');
    expect(restroomEn.title).toBe('Restroom on the way');
    expect(restroomEn.none(800)).toContain('800 m in a straight line');
    expect(Object.keys(restroomEs).sort()).toEqual(Object.keys(restroomEn).sort());
  });
});

describe('the public restrooms layer of Explore', () => {
  it('is a place, off when Explore opens, never listed by a time', () => {
    expect(FIRST_ON.has('restrooms')).toBe(false);
    expect(toneOf('restrooms')).toBe('place');
    const item: CityItem = {
      id: 'restrooms:-73.86,40.83:Parkchester Library, NYPL',
      layer: 'restrooms',
      sourceId: 'nyc-public-restrooms',
      title: 'Parkchester Library, NYPL',
      point: [-73.86, 40.83],
      lines: [],
      detail: { kind: 'restroom', ...facts },
    };
    expect(itemTime(item, now)).toBeNull();
  });

  it('is named and explained in English and Spanish, with every kind of fact', () => {
    expect([cityEn.layers.restrooms, cityEs.layers.restrooms]).toEqual([
      'Public restrooms',
      'Aseos públicos',
    ]);
    expect(cardEs.restroom.hours).toBe('Horario publicado, en inglés');
    expect(Object.keys(cardEs.restroom.stallKinds)).toEqual(
      Object.keys(cardEn.restroom.stallKinds),
    );
    expect(cardEn.restroom.never).toContain('never works out');
  });
});
