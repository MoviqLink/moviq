import { describe, expect, it } from 'vitest';

import {
  nextStops,
  restroomFactsSchema,
  restroomsNearResponseSchema,
  type Leg,
  type Place,
} from '../src/index.js';

const place = (label: string): Place => ({
  label,
  lat: 40.75,
  lon: -73.98,
  kind: 'station',
  stopId: null,
});

const leg = (to: string, arriveAt: string): Leg => ({
  mode: 'subway',
  from: place('Start'),
  to: place(to),
  departAt: '2026-11-11T12:00:00.000Z',
  arriveAt,
  route: null,
  tripId: null,
  timing: 'scheduled',
  provenance: {
    sourceId: 'transitous',
    dataTime: null,
    receivedAt: null,
    ageSeconds: null,
    state: 'healthy',
    evidence: 'Written for the test.',
  },
  path: [],
});

describe('the next stops of a trip', () => {
  it('are where each leg not yet over ends, each once, three at most', () => {
    const legs = [
      leg('Parkchester', '2026-11-11T12:05:00.000Z'),
      leg('Grand Central-42 St', '2026-11-11T12:30:00.000Z'),
      leg('Grand Central-42 St', '2026-11-11T12:31:00.000Z'),
      leg('89 East 42nd Street', '2026-11-11T12:40:00.000Z'),
      leg('Somewhere else', '2026-11-11T12:50:00.000Z'),
    ];
    const at = (iso: string) => nextStops(legs, Date.parse(iso)).map((stop) => stop.label);
    expect(at('2026-11-11T12:00:00.000Z')).toEqual([
      'Parkchester',
      'Grand Central-42 St',
      '89 East 42nd Street',
    ]);
    expect(at('2026-11-11T12:35:00.000Z')).toEqual(['89 East 42nd Street', 'Somewhere else']);
    expect(at('2026-11-11T13:00:00.000Z')).toEqual([]);
  });
});

describe('restrooms', () => {
  it('take an official page over HTTP or HTTPS only, and the list may be unknown, never empty', () => {
    const facts = restroomFactsSchema.shape.website;
    expect(facts.safeParse('https://www.nypl.org/locations/parkchester').success).toBe(true);
    expect(facts.safeParse('javascript:alert(1)').success).toBe(false);
    expect(restroomsNearResponseSchema.shape.restrooms.safeParse(null).success).toBe(true);
  });
});
