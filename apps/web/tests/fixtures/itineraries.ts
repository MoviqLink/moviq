import type { Itinerary, Leg, Place, Provenance } from '@moviq/contracts';

import {
  ALIGHT,
  ASTORIA,
  ASTORIA_DITMARS,
  BOARD,
  BUS,
  HOME,
  SUBWAY,
  TAXI,
  TERMINAL,
  WALK_IN,
  WALK_OUT,
  type Lang,
  type Position,
} from './geography';

// The itineraries of the scene, built leg by leg as offsets from `now`.

export const iso = (ms: number) => new Date(ms).toISOString();
export const min = 60_000;

export function provenance(
  now: number,
  sourceId: string,
  ageSeconds: number,
  evidence: string,
): Provenance {
  return {
    sourceId,
    dataTime: iso(now - ageSeconds * 1000),
    receivedAt: iso(now - (ageSeconds - 1) * 1000),
    ageSeconds,
    state: 'healthy',
    evidence,
  };
}

interface LegSpec {
  readonly mode: Leg['mode'];
  readonly from: Place;
  readonly to: Place;
  readonly at: [number, number];
  readonly path: Position[];
  readonly route?: { id: string; shortName: string; headsign: string | null };
  readonly timing: Leg['timing'];
  readonly source: [string, number, string];
}

function leg(now: number, start: number, spec: LegSpec): Leg {
  const [sourceId, age, evidence] = spec.source;
  return {
    mode: spec.mode,
    from: spec.from,
    to: spec.to,
    departAt: iso(start + spec.at[0] * min),
    arriveAt: iso(start + spec.at[1] * min),
    route: spec.route ?? null,
    tripId: spec.route === undefined ? null : `${spec.route.id}-trip`,
    timing: spec.timing,
    provenance: provenance(now, sourceId, age, evidence),
    path: spec.path,
  };
}

const walking: [string, number, string] = ['transitous', 40, 'Walking time from the trip planner.'];
const M60 = { id: 'MTA NYCT_M60+', shortName: 'M60-SBS', headsign: 'LaGuardia Airport' };

function itinerary(id: string, legs: Leg[], deadline: number, fare: Itinerary['fare']): Itinerary {
  const first = legs[0];
  const last = legs.at(-1);
  if (first === undefined || last === undefined) throw new Error('an itinerary needs legs');
  return {
    id,
    departAt: first.departAt,
    arriveAt: last.arriveAt,
    spareMinutes: Math.floor((deadline - Date.parse(last.arriveAt)) / min),
    transfers: Math.max(0, legs.filter((l) => l.mode !== 'walk').length - 1),
    walkMinutes: legs
      .filter((l) => l.mode === 'walk')
      .reduce(
        (sum, l) => sum + Math.round((Date.parse(l.arriveAt) - Date.parse(l.departAt)) / min),
        0,
      ),
    legs,
    fare,
  };
}

const omny = (lang: Lang): Itinerary['fare'] => ({
  amount: { amountMinor: 290, currency: 'USD' },
  note:
    lang === 'es'
      ? 'Se paga con OMNY al subir. Transbordo gratis entre bus y metro durante 2 horas.'
      : 'Paid with OMNY on board. One free transfer between bus and subway within 2 hours.',
});

/** The scene every fixture shares: leave in 12 min, be at LaGuardia Terminal B 70 min later. */
export function scene(now: number) {
  const start = now + 12 * min;
  return { start, deadline: start + 83 * min };
}

export function busItinerary(now: number, lang: Lang): Itinerary {
  const { start, deadline } = scene(now);
  const bus: [string, number, string] = [
    'mta-bus-time',
    18,
    'SIRI prediction for the M60-SBS at Lexington Av / E 125 St.',
  ];
  return itinerary(
    'it-m60',
    [
      leg(now, start, {
        mode: 'walk',
        from: HOME,
        to: BOARD,
        at: [0, 5],
        path: WALK_IN,
        timing: 'estimated',
        source: walking,
      }),
      leg(now, start, {
        mode: 'bus',
        from: BOARD,
        to: ALIGHT,
        at: [9, 41],
        path: BUS,
        route: M60,
        timing: 'realtime',
        source: bus,
      }),
      leg(now, start, {
        mode: 'walk',
        from: ALIGHT,
        to: TERMINAL,
        at: [41, 45],
        path: WALK_OUT,
        timing: 'estimated',
        source: walking,
      }),
    ],
    deadline,
    omny(lang),
  );
}

export function subwayItinerary(now: number, lang: Lang): Itinerary {
  const { start, deadline } = scene(now);
  const timetable: [string, number, string] = ['mta-gtfs', 3_600, 'Published subway timetable.'];
  const q70 = { id: 'MTA NYCT_Q70+', shortName: 'Q70-SBS', headsign: 'LaGuardia Airport' };
  return itinerary(
    'it-subway',
    [
      leg(now, start, {
        mode: 'walk',
        from: HOME,
        to: SUBWAY,
        at: [-4, 0],
        path: WALK_IN.slice(0, 3),
        timing: 'estimated',
        source: walking,
      }),
      leg(now, start, {
        mode: 'subway',
        from: SUBWAY,
        to: ASTORIA_DITMARS,
        at: [3, 24],
        path: BUS.slice(0, 9),
        route: { id: 'MTA_N', shortName: 'N', headsign: 'Astoria' },
        timing: 'scheduled',
        source: timetable,
      }),
      leg(now, start, {
        mode: 'bus',
        from: ASTORIA_DITMARS,
        to: ALIGHT,
        at: [29, 42],
        path: TAXI,
        route: q70,
        timing: 'scheduled',
        source: timetable,
      }),
      leg(now, start, {
        mode: 'walk',
        from: ALIGHT,
        to: TERMINAL,
        at: [42, 46],
        path: WALK_OUT,
        timing: 'estimated',
        source: walking,
      }),
    ],
    deadline,
    omny(lang),
  );
}

export function taxiItinerary(now: number): Itinerary {
  const { start, deadline } = scene(now);
  const bus: [string, number, string] = [
    'mta-bus-time',
    18,
    'SIRI vehicle position of the M60-SBS.',
  ];
  const road: [string, number, string] = [
    'nyc-dot-traffic',
    60,
    'Road speeds on the Grand Central Pkwy.',
  ];
  return itinerary(
    'alt-taxi',
    [
      leg(now, start, {
        mode: 'bus',
        from: BOARD,
        to: ASTORIA,
        at: [9, 24],
        path: BUS.slice(0, 9),
        route: M60,
        timing: 'realtime',
        source: bus,
      }),
      leg(now, start, {
        mode: 'taxi',
        from: ASTORIA,
        to: TERMINAL,
        at: [25, 37],
        path: TAXI,
        timing: 'estimated',
        source: road,
      }),
    ],
    deadline,
    null,
  );
}

/** A free alternative: off the M60 at Astoria Blvd, then the Q70 to the terminal. */
export function q70Itinerary(now: number): Itinerary {
  const { start, deadline } = scene(now);
  const live: [string, number, string] = ['mta-bus-time', 18, 'SIRI predictions for M60 and Q70.'];
  const q70 = { id: 'MTA NYCT_Q70+', shortName: 'Q70-SBS', headsign: 'LaGuardia Airport' };
  return itinerary(
    'alt-q70',
    [
      leg(now, start, {
        mode: 'bus',
        from: BOARD,
        to: ASTORIA,
        at: [9, 24],
        path: BUS.slice(0, 9),
        route: M60,
        timing: 'realtime',
        source: live,
      }),
      leg(now, start, {
        mode: 'bus',
        from: ASTORIA,
        to: ALIGHT,
        at: [31, 47],
        path: TAXI,
        route: q70,
        timing: 'realtime',
        source: live,
      }),
      leg(now, start, {
        mode: 'walk',
        from: ALIGHT,
        to: TERMINAL,
        at: [47, 51],
        path: WALK_OUT,
        timing: 'estimated',
        source: walking,
      }),
    ],
    deadline,
    null,
  );
}
