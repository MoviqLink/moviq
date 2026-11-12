import type { Incident, Itinerary, Journey, Leg, Place, Provenance } from '@moviq/contracts';

import { iso, min, provenance } from './itineraries';

// A step-free trip from Madison Square Garden to Grand Central: the 1 from 34 St-Penn Station
// to Times Sq-42 St, a change there to the 7, and the 7 to Grand Central-42 St.

const place = (label: string, lat: number, lon: number, stopId: string | null): Place => ({
  label,
  lat,
  lon,
  kind: stopId === null ? 'address' : 'station',
  stopId,
});

const ORIGIN = place('Madison Square Garden', 40.7505, -73.9934, null);
const PENN = place('34 St-Penn Station', 40.750373, -73.991057, '128N');
const TIMES_SQ_1 = place('Times Sq-42 St', 40.75529, -73.987495, '127N');
const TIMES_SQ_7 = place('Times Sq-42 St', 40.755477, -73.987691, '725N');
const GRAND_CENTRAL = place('Grand Central-42 St', 40.751431, -73.976041, '723N');
const DESTINATION = place('Grand Central Terminal', 40.7527, -73.9772, null);

const ENGINE = 'MovIQ engine (RAPTOR, arrive by) on mta-gtfs-subway.';

function leg(now: number, from: Place, to: Place, at: [number, number], line?: string): Leg {
  const start = now + 2 * min;
  return {
    mode: line === undefined ? 'walk' : 'subway',
    from,
    to,
    departAt: iso(start + at[0] * min),
    arriveAt: iso(start + at[1] * min),
    route: line === undefined ? null : { id: line, shortName: line, headsign: null },
    tripId: line === undefined ? null : `${line}-trip`,
    timing: line === undefined ? 'estimated' : 'scheduled',
    provenance: provenance(now, 'moviq-raptor', 30, ENGINE),
    path: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  };
}

function outages(now: number, state: Provenance['state']): Provenance {
  const read = provenance(now, 'mta-elevators', 120, 'Data is 2 min old.');
  return state === 'healthy'
    ? read
    : { ...read, state, evidence: 'The MTA has not answered for 3 hours.' };
}

type Variant = 'clear' | 'elevator-out' | 'lists-down';

function accessibility(now: number, variant: Variant): Itinerary['accessibility'] {
  const open = { cause: null, elevators: [] };
  const down = { state: 'unknown' as const, cause: 'lists-unavailable' as const, elevators: [] };
  const states = (index: number) => {
    if (variant === 'lists-down') return down;
    if (variant === 'elevator-out' && index === 3) {
      const elevator = {
        id: 'EL723',
        serving: 'Street to mezzanine for the 7',
        since: iso(now - 95 * min),
        estimatedReturn: iso(now + 4 * 60 * min),
        upcoming: false,
      };
      return { state: 'elevator-out' as const, cause: 'outage' as const, elevators: [elevator] };
    }
    return { state: 'accessible' as const, ...open };
  };
  const at = (legIndex: number, side: 'board' | 'alight', where: Place, index: number) => ({
    legIndex,
    at: side,
    stopId: where.stopId,
    station: where.label,
    ...states(index),
  });
  return {
    checkedAt: variant === 'lists-down' ? null : iso(now - 120_000),
    provenance: outages(now, variant === 'lists-down' ? 'unavailable' : 'healthy'),
    platforms: [
      at(1, 'board', PENN, 0),
      at(1, 'alight', TIMES_SQ_1, 1),
      at(3, 'board', TIMES_SQ_7, 2),
      at(3, 'alight', GRAND_CENTRAL, 3),
    ],
    warnings: [
      { kind: 'modes-left-out', modes: ['bus'] },
      { kind: 'change-unverified', legIndex: 2, from: 'Times Sq-42 St', to: 'Times Sq-42 St' },
    ],
  };
}

function incident(now: number, variant: Variant): Incident[] {
  if (variant === 'clear') return [];
  return [
    variant === 'elevator-out'
      ? {
          id: 'elevator:3:EL723',
          at: iso(now - 60_000),
          legIndex: 3,
          kind: 'elevator',
          evidence:
            'The MTA says elevator EL723 at Grand Central-42 St (Street to mezzanine for the 7) ' +
            'is out of service since 08:24. Your step-free route needs it.',
          provenance: outages(now, 'healthy'),
          impactMinutes: null,
        }
      : {
          id: 'source-down:step-free:mta-elevators',
          at: iso(now - 60_000),
          legIndex: 1,
          kind: 'source-down',
          evidence:
            'The MTA elevator outages cannot be used, so the step-free route is not confirmed: ' +
            'the MTA has not answered for 3 hours.',
          provenance: outages(now, 'unavailable'),
          impactMinutes: null,
        },
  ];
}

/** The step-free trip, clear, with an elevator out on its way, or with the MTA lists down. */
export function stepFreeJourney(now: number, variant: Variant): Journey {
  const legs = [
    leg(now, ORIGIN, PENN, [0, 4]),
    leg(now, PENN, TIMES_SQ_1, [6, 9], '1'),
    leg(now, TIMES_SQ_1, TIMES_SQ_7, [9, 13]),
    leg(now, TIMES_SQ_7, GRAND_CENTRAL, [15, 17], '7'),
    leg(now, GRAND_CENTRAL, DESTINATION, [17, 21]),
  ];
  const arriveBy = iso(now + 40 * min);
  return {
    id: `trip-step-free-${variant}`,
    state: 'watching',
    request: {
      origin: ORIGIN,
      destination: DESTINATION,
      arriveBy,
      preferences: {
        maxWalkMinutes: 15,
        stepFree: true,
        modes: ['walk', 'subway', 'bus'],
        spareMinutes: 10,
      },
      flight: null,
    },
    itinerary: {
      id: 'it-step-free',
      departAt: legs[0]?.departAt ?? arriveBy,
      arriveAt: legs.at(-1)?.arriveAt ?? arriveBy,
      spareMinutes: 17,
      transfers: 1,
      walkMinutes: 12,
      legs,
      fare: null,
      accessibility: accessibility(now, variant),
    },
    createdAt: iso(now - 4 * min),
    watch: {
      status: variant === 'clear' ? 'on-track' : variant === 'elevator-out' ? 'at-risk' : 'unknown',
      evaluatedAt: iso(now - 20_000),
      projectedArriveAt: null,
      evidence:
        variant === 'clear'
          ? 'On track: arriving about 10:23, 17 min to spare.'
          : variant === 'elevator-out'
            ? 'The step-free route needs elevator EL723 at Grand Central-42 St, which is out of ' +
              'service; looking for another way.'
            : 'The MTA elevator outages cannot be read now, so the step-free route is not ' +
              'confirmed.',
      flight: null,
      stepFreeRefusal:
        variant === 'lists-down'
          ? {
              reason: 'lists-unavailable',
              detail: 'The timetables served do not say which stops are step-free.',
            }
          : null,
    },
    incidents: incident(now, variant),
    alternatives: [],
  };
}
