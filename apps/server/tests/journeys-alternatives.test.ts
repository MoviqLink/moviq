import type { Journey } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { findAlternatives } from '../src/modules/journeys/alternatives.js';
import { toItinerary } from '../src/modules/journeys/itineraries.js';
import type { RoutedItinerary, RoutingProvider } from '../src/modules/journeys/ports.js';
import {
  BRYANT_PARK,
  HARLEM,
  planRequest,
  ROUTING_PROVENANCE,
  subwayTrip,
} from './support/journeys.js';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const DEADLINE = '2026-11-11T16:00:00.000Z';

const taxiRide: RoutedItinerary = {
  legs: [
    {
      mode: 'taxi',
      from: HARLEM,
      to: BRYANT_PARK,
      departAt: new Date('2026-11-11T15:05:00.000Z'),
      arriveAt: new Date('2026-11-11T15:25:00.000Z'),
      route: null,
      tripId: null,
      scheduled: false,
      path: [
        [-73.9454, 40.8075],
        [-73.9832, 40.7536],
      ],
    },
  ],
};

/** Answers transit queries with one subway trip and road queries with a taxi ride. */
const routing: RoutingProvider = {
  sourceId: 'transitous',
  plan: (query) =>
    Promise.resolve({
      ok: true,
      provenance: ROUTING_PROVENANCE,
      value: query.modes.includes('taxi')
        ? [taxiRide]
        : [subwayTrip('2026-11-11T15:10:00.000Z', '2026-11-11T15:45:00.000Z')],
    }),
};

function journey(airport: 'JFK' | 'EWR' | null = null): Journey {
  const request = planRequest(DEADLINE);
  const flight =
    airport === null
      ? null
      : {
          carrier: 'DL',
          number: '405',
          departureAt: '2026-11-11T18:00:00.000Z',
          revisedDeparture: null,
          takeOffAt: null,
          airport,
          terminal: null,
          gate: null,
          status: null,
          callSign: null,
          aircraftHex: null,
          provenance: ROUTING_PROVENANCE,
        };
  return {
    id: 'j1',
    state: 'watching',
    request: { ...request, flight },
    itinerary: toItinerary(
      subwayTrip('2026-11-11T15:02:00.000Z', '2026-11-11T15:40:00.000Z'),
      ROUTING_PROVENANCE,
      new Date(DEADLINE),
      { fareFor: () => null },
    ),
    createdAt: '2026-11-11T14:30:00.000Z',
    watch: {
      status: 'at-risk',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Late.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}

describe('findAlternatives', () => {
  it('offers the demo partner taxi at the official rates next to the transit options, earliest first', async () => {
    const { alternatives: options, refused } = await findAlternatives(
      journey(),
      routing,
      { fareFor: () => null },
      NOW,
    );
    expect(refused).toBeUndefined();
    expect(
      options.map((option) => [
        option.itinerary.legs[0]?.mode,
        option.recommended,
        option.price?.amountMinor ?? null,
      ]),
    ).toEqual([
      ['taxi', true, 2325],
      ['subway', false, null],
    ]);
    expect(options[0]?.why).toBe(
      'A taxi of our demo partner, paid with PayPal: arrives at 10:25, 35 min to spare: the earliest option.',
    );
    expect(options[0]?.itinerary.fare?.note).toContain('official NYC TLC');
  });

  it('offers no taxi where MovIQ has no verified price', async () => {
    const { alternatives: options } = await findAlternatives(
      journey('EWR'),
      routing,
      { fareFor: () => null },
      NOW,
    );
    expect(options.every((option) => option.price === null)).toBe(true);
  });
});
