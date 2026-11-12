import type { Place, PlanRequest, Provenance } from '@moviq/contracts';

import type {
  RoutedItinerary,
  RoutedLeg,
  RoutingProvider,
} from '../../src/modules/journeys/ports.js';

export const HARLEM: Place = {
  label: '125 St',
  lat: 40.8075,
  lon: -73.9454,
  kind: 'station',
  stopId: 'A27',
};
export const BRYANT_PARK: Place = {
  label: 'Bryant Park',
  lat: 40.7536,
  lon: -73.9832,
  kind: 'address',
  stopId: null,
};

export const ROUTING_PROVENANCE: Provenance = {
  sourceId: 'transitous',
  dataTime: '2026-11-11T17:00:00.000Z',
  receivedAt: '2026-11-11T17:00:00.000Z',
  ageSeconds: 0,
  state: 'healthy',
  evidence: 'Planned by the routing engine just now.',
};

export function planRequest(arriveBy = '2026-11-11T19:00:00.000Z', spareMinutes = 10): PlanRequest {
  return {
    origin: HARLEM,
    destination: BRYANT_PARK,
    arriveBy,
    preferences: {
      maxWalkMinutes: 15,
      stepFree: false,
      modes: ['walk', 'subway', 'bus'],
      spareMinutes,
    },
    flight: null,
  };
}

/** A subway ride between two instants, with a short walk at the end. */
export function subwayTrip(departAt: string, arriveAt: string): RoutedItinerary {
  const walkStart = new Date(Date.parse(arriveAt) - 5 * 60_000);
  const ride: RoutedLeg = {
    mode: 'subway',
    from: HARLEM,
    to: { label: '42 St', lat: 40.7557, lon: -73.9869, kind: 'station', stopId: 'A27' },
    departAt: new Date(departAt),
    arriveAt: walkStart,
    route: { id: 'A', shortName: 'A', headsign: 'Far Rockaway' },
    tripId: 'A-trip-1',
    scheduled: true,
    path: [
      [-73.9454, 40.8075],
      [-73.9869, 40.7557],
    ],
  };
  const walk: RoutedLeg = {
    mode: 'walk',
    from: ride.to,
    to: BRYANT_PARK,
    departAt: walkStart,
    arriveAt: new Date(arriveAt),
    route: null,
    tripId: null,
    scheduled: false,
    path: [
      [-73.9869, 40.7557],
      [-73.9832, 40.7536],
    ],
    walk: { basis: 'street', profile: 'foot', metres: 410, unchecked: null },
  };
  return { legs: [ride, walk] };
}

/** A routing engine that answers with the itineraries given, or fails as told. */
export function fakeRouting(
  answer: readonly RoutedItinerary[] | 'down',
): RoutingProvider & { readonly calls: () => number } {
  let calls = 0;
  return {
    sourceId: 'transitous',
    calls: () => calls,
    plan: () => {
      calls += 1;
      return Promise.resolve(
        answer === 'down'
          ? {
              ok: false,
              state: 'unavailable',
              code: 'http-503',
              detail: 'The routing engine did not answer.',
            }
          : { ok: true, value: answer, provenance: ROUTING_PROVENANCE },
      );
    },
  };
}
