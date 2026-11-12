import type { Journey, Leg, Place, Provenance, SourceState } from '@moviq/contracts';

import type { SourceReader } from '../../src/modules/data-platform/reader.js';
import type { ElevatorOutages } from '../../src/modules/data-platform/sources/mta/elevators.js';
import type { StepFreeSources } from '../../src/modules/journeys/engine/step-free.js';
import { STEP_FREE_SOURCES } from '../../src/modules/journeys/step-free-lists.js';

/** When the lists were read: 16:20 in New York. */
const READ_AT = '2026-11-11T21:20:00.000Z';

type Station = StepFreeSources['stations']['stations'][string];

const full = (name: string, complex: string): Station => ({
  name,
  complex,
  ada: 'full',
  northbound: true,
  southbound: true,
  note: null,
});

/**
 * A few stations as the MTA lists write them: from Times Sq-42 St (725) on the 7 to 5 Av (724),
 * a change inside the complex to 42 St-Bryant Pk (D16), and the D to 34 St-Herald Sq (D17),
 * whose elevator EL293 the outages feed may close. 86 St (626) is accessible uptown only.
 */
export function stepFreeLists(outages: ElevatorOutages['outages'] = []): StepFreeSources {
  const elevator = (stations: string[]) => ({
    kind: 'elevator' as const,
    ada: true,
    active: true,
    redundant: false,
    stations,
  });
  const inService = { kind: 'elevator' as const, ada: true, status: 'IFIS' };
  const none = { access: [], street: [], mezzanine: [], platform: [] };
  const entrance = (station: string, name: string, lon: number, lat: number) => ({
    stations: [station],
    complex: '609',
    name,
    type: 'Elevator',
    entry: true,
    exit: true,
    point: [lon, lat] as [number, number],
  });
  return {
    stations: {
      readAt: READ_AT,
      stations: {
        '725': full('Times Sq-42 St', '611'),
        '724': full('5 Av', '609'),
        D16: full('42 St-Bryant Pk', '609'),
        D17: full('34 St-Herald Sq', '607'),
        '626': { ...full('86 St', '613'), ada: 'partial', southbound: false, note: 'Uptown only' },
      },
    },
    equipment: {
      readAt: READ_AT,
      equipment: { EL293: elevator(['D17']), EL232: elevator(['725']), EL420: elevator(['724']) },
    },
    inventory: {
      readAt: READ_AT,
      equipment: {
        EL293: { ...inService, backups: none },
        EL232: { ...inService, backups: none },
        EL420: { ...inService, backups: none },
      },
    },
    outages: { readAt: READ_AT, outages },
    // The survey lists elevators at 724, D16 and D17, none at Times Sq-42 St (725).
    entrances: {
      readAt: READ_AT,
      entrances: [
        entrance('724', '5 Av', -73.9819, 40.7538),
        entrance('D16', '42 St-Bryant Pk', -73.9842, 40.7542),
        entrance('D17', '34 St-Herald Sq', -73.9879, 40.7497),
      ],
    },
  };
}

/** EL293 at 34 St-Herald Sq out since 16:01, back about 22:00, as the MTA writes it. */
export const D17_OUTAGE: ElevatorOutages['outages'][number] = {
  equipmentId: 'EL293',
  kind: 'elevator',
  station: '34 St-Herald Sq',
  lines: ['B', 'D', 'F', 'M'],
  serving: 'Street to mezzanine',
  ada: true,
  reason: 'Repair',
  since: '2026-11-11T21:01:00.000Z',
  estimatedReturn: '2026-11-12T03:00:00.000Z',
  upcoming: false,
  maintenance: false,
};

export function listProvenance(sourceId: string, state: SourceState = 'healthy'): Provenance {
  return {
    sourceId,
    dataTime: READ_AT,
    receivedAt: READ_AT,
    ageSeconds: 60,
    state,
    evidence: state === 'healthy' ? 'Data is 1 min old.' : `The source is ${state}.`,
  };
}

/**
 * The step-free lists served by a reader, validated by each definition's schema like the real
 * one; `states` sets the state of some of them. Any other source goes to `others`.
 */
export function stepFreeReader(
  lists: StepFreeSources,
  others: SourceReader,
  states: Readonly<Record<string, SourceState>> = {},
): SourceReader {
  const byId: Readonly<Record<string, unknown>> = {
    'mta-elevators': lists.outages,
    'mta-subway-stations': lists.stations,
    'mta-elevator-equipment': lists.equipment,
    'mta-elevator-inventory': lists.inventory,
    'mta-subway-entrances': lists.entrances,
  };
  const ids = new Set(STEP_FREE_SOURCES.map((source) => source.id));
  return {
    read: (definition) => {
      if (!ids.has(definition.id)) return others.read(definition);
      const state = states[definition.id] ?? 'healthy';
      const usable = state !== 'unavailable';
      return Promise.resolve({
        data: usable ? definition.dataSchema.parse(byId[definition.id]) : undefined,
        provenance: listProvenance(definition.id, state),
      });
    },
  };
}

const stop = (stopId: string, label: string, lon: number, lat: number): Place => ({
  label,
  lat,
  lon,
  kind: 'station',
  stopId,
});

const ORIGIN: Place = {
  label: 'Bryant Park',
  lat: 40.7536,
  lon: -73.9832,
  kind: 'address',
  stopId: null,
};
const DESTINATION: Place = {
  label: 'Macy’s',
  lat: 40.7508,
  lon: -73.9893,
  kind: 'address',
  stopId: null,
};
const TIMES_SQ = stop('725S', 'Times Sq-42 St', -73.9876, 40.7553);
const FIFTH_AV = stop('724S', '5 Av', -73.9819, 40.7538);
const BRYANT_PK = stop('D16S', '42 St-Bryant Pk', -73.9842, 40.7542);
const HERALD_SQ = stop('D17S', '34 St-Herald Sq', -73.9879, 40.7497);

const route = (line: string) => ({ id: line, shortName: line, headsign: null });

function leg(mode: Leg['mode'], from: Place, to: Place, departAt: string, arriveAt: string): Leg {
  return {
    mode,
    from,
    to,
    departAt,
    arriveAt,
    route: mode === 'walk' ? null : route(from === TIMES_SQ ? '7' : 'D'),
    tripId: mode === 'walk' ? null : `${from.label}-trip`,
    timing: mode === 'walk' ? 'estimated' : 'scheduled',
    provenance: listProvenance('moviq-raptor'),
    path: [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ],
  };
}

/** Walk to Times Sq-42 St, the 7 to 5 Av, a change to 42 St-Bryant Pk, the D to 34 St-Herald Sq. */
export function heraldSquareLegs(): Leg[] {
  return [
    leg('walk', ORIGIN, TIMES_SQ, '2026-11-11T21:30:00.000Z', '2026-11-11T21:36:00.000Z'),
    leg('subway', TIMES_SQ, FIFTH_AV, '2026-11-11T21:38:00.000Z', '2026-11-11T21:40:00.000Z'),
    leg('walk', FIFTH_AV, BRYANT_PK, '2026-11-11T21:40:00.000Z', '2026-11-11T21:43:00.000Z'),
    leg('subway', BRYANT_PK, HERALD_SQ, '2026-11-11T21:45:00.000Z', '2026-11-11T21:47:00.000Z'),
    leg('walk', HERALD_SQ, DESTINATION, '2026-11-11T21:47:00.000Z', '2026-11-11T21:52:00.000Z'),
  ];
}

/** A journey on those legs, step-free or not, to be there by 17:00 in New York. */
export function heraldSquareJourney(stepFree: boolean): Journey {
  const legs = heraldSquareLegs();
  return {
    id: 'j-step-free',
    state: 'watching',
    request: {
      origin: ORIGIN,
      destination: DESTINATION,
      arriveBy: '2026-11-11T22:00:00.000Z',
      preferences: {
        maxWalkMinutes: 15,
        stepFree,
        modes: ['walk', 'subway', 'bus'],
        spareMinutes: 5,
      },
      flight: null,
    },
    itinerary: {
      id: 'it-herald',
      departAt: '2026-11-11T21:30:00.000Z',
      arriveAt: '2026-11-11T21:52:00.000Z',
      spareMinutes: 8,
      transfers: 1,
      walkMinutes: 14,
      legs,
      fare: null,
      accessibility: null,
    },
    createdAt: READ_AT,
    watch: {
      status: 'unknown',
      evaluatedAt: null,
      projectedArriveAt: null,
      evidence: 'Not checked yet.',
      flight: null,
      stepFreeRefusal: null,
    },
    incidents: [],
    alternatives: [],
  };
}
