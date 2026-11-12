import type { Place, SourceState } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import type { SourceDefinition } from '../../../src/modules/data-platform/definition.js';
import type { SourceReader } from '../../../src/modules/data-platform/reader.js';
import { mtaElevatorEquipment } from '../../../src/modules/data-platform/sources/accessibility/elevator-equipment.js';
import { mtaElevatorInventory } from '../../../src/modules/data-platform/sources/accessibility/elevator-inventory.js';
import { mtaSubwayStations } from '../../../src/modules/data-platform/sources/accessibility/subway-stations.js';
import { mtaElevators } from '../../../src/modules/data-platform/sources/mta/elevators.js';
import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import type { GtfsIndex } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { createMovIqRouting } from '../../../src/modules/journeys/engine/moviq-routing.js';
import type { RouteQuery, RoutingProvider } from '../../../src/modules/journeys/ports.js';
import { CAPTURED_AT, capture } from '../../sources/mta/captures.js';
import { provenance, summary } from './hand-network.js';

type Served = Readonly<
  Record<string, { readonly data: unknown; readonly version: string; readonly state?: SourceState }>
>;

function captured<T>(definition: SourceDefinition<T> | undefined, file: string): T {
  if (definition === undefined) throw new Error('no source');
  const result = definition.parse(capture(file), { receivedAt: CAPTURED_AT, previous: undefined });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

const SUBWAY: GtfsIndex = captured(gtfsStaticSources[0], 'gtfs_subway.zip');
const OUTAGES = { data: captured(mtaElevators, 'elevators.json'), version: 'o1' };
const ACCESS: Served = {
  'mta-gtfs-subway': { data: SUBWAY, version: 'v1' },
  'mta-subway-stations': {
    data: captured(mtaSubwayStations, 'subway-stations.json'),
    version: 's1',
  },
  'mta-elevator-equipment': {
    data: captured(mtaElevatorEquipment, 'elevator-equipment.json'),
    version: 'e1',
  },
  'mta-elevator-inventory': {
    data: captured(mtaElevatorInventory, 'elevator-inventory.json'),
    version: 'i1',
  },
  'mta-elevators': OUTAGES,
  'mta-subway-entrances': {
    data: { readAt: CAPTURED_AT.toISOString(), entrances: [] },
    version: 'n1',
  },
};

/** A reader that serves the given data, validated by each schema as the real one does. */
function readerOf(served: Served): SourceReader {
  return {
    read: (definition) => {
      const entry = served[definition.id];
      const state = entry?.state ?? (entry === undefined ? 'unavailable' : 'healthy');
      const base = { provenance: provenance(definition.id, state) };
      if (entry === undefined) return Promise.resolve({ ...base, data: undefined });
      const data = definition.dataSchema.parse(entry.data);
      return Promise.resolve({ ...base, data, version: entry.version });
    },
  };
}

function fallback(answer: 'ok' | 'fail'): RoutingProvider & { readonly calls: () => number } {
  let calls = 0;
  return {
    sourceId: 'transitous',
    calls: () => calls,
    plan() {
      calls += 1;
      if (answer === 'fail') {
        return Promise.resolve({
          ok: false,
          state: 'unavailable',
          code: 'http-503',
          detail: 'Down.',
        });
      }
      return Promise.resolve({ ok: true, value: [], provenance: provenance('transitous') });
    },
  };
}

function station(stopId: string): Place {
  const stop = SUBWAY.stops[stopId];
  return {
    label: stop?.name ?? stopId,
    lat: stop?.lat ?? 0,
    lon: stop?.lon ?? 0,
    kind: 'station',
    stopId,
  };
}

/**
 * 96 St to 59 St-Columbus Circle by 00:50 on Wednesday 11/11/2026: the 00:06:30 1 train, both
 * step-free. Times Sq-42 St is not: the inventory has removed three elevators of its path.
 */
const RIDE: RouteQuery = {
  from: station('120'),
  to: station('125'),
  arriveBy: new Date('2026-11-11T00:50:00-05:00'),
  modes: ['subway'],
  maxWalkMinutes: 0,
  stepFree: true,
  count: 3,
};

function routing(served: Served, other = fallback('ok')) {
  const clock = { now: () => new Date('2026-11-11T00:00:00-05:00') };
  return {
    other,
    provider: createMovIqRouting({ reader: readerOf(served), clock, fallback: other }),
  };
}

describe('MovIQ routing over the data platform', () => {
  it('plans on the served subway timetable with its step-free stations, without the fallback', async () => {
    const { provider, other } = routing(ACCESS);
    const outcome = await provider.plan(RIDE);
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.value.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway 1 120S 00:32:30 > 125S 00:40:00'],
    ]);
    expect(outcome.provenance.sourceId).toBe('moviq-raptor');
    expect(outcome.provenance.evidence).toMatch(
      /on mta-gtfs-subway@v1\+step-free\.s1\.e1\.i1\.n1\.\w{8} /,
    );
    expect(outcome.provenance.evidence).toContain('without mta-gtfs-bus-brooklyn (unavailable)');
    expect(other.calls()).toBe(0);
  });

  it('refuses a step-free plan without asking the fallback while the outages are stale', async () => {
    const stale: Served = { ...ACCESS, 'mta-elevators': { ...OUTAGES, state: 'stale' } };
    const { provider, other } = routing(stale);
    expect(await provider.plan(RIDE)).toMatchObject({ ok: false, code: 'no-step-free-data' });
    expect(other.calls()).toBe(0);
  });

  it('refuses a step-free plan without the fallback when an outage cannot be placed', async () => {
    const [first] = OUTAGES.data.outages;
    if (first === undefined) throw new Error('the capture has outages');
    const unplaced = { ...first, equipmentId: 'EL999', upcoming: false };
    const outages = { ...OUTAGES.data, outages: [...OUTAGES.data.outages, unplaced] };
    const { provider, other } = routing({
      ...ACCESS,
      'mta-elevators': { ...OUTAGES, data: outages },
    });
    expect(await provider.plan(RIDE)).toMatchObject({ ok: false, code: 'no-step-free-data' });
    expect(other.calls()).toBe(0);
  });

  it('gives the engine its own no-itineraries for a step-free plan, without the fallback', async () => {
    const { provider, other } = routing(ACCESS);
    // Van Cortlandt Park-242 St has no step-free access; Transitous gave the 1 to it.
    const north = { ...RIDE, to: station('101') };
    expect(await provider.plan(north)).toMatchObject({ ok: false, code: 'no-itineraries' });
    const timesSquare = { ...RIDE, to: station('127') };
    expect(await provider.plan(timesSquare)).toMatchObject({ ok: false, code: 'no-itineraries' });
    expect(await provider.plan({ ...timesSquare, stepFree: false })).toMatchObject({ ok: true });
    expect(other.calls()).toBe(0);
  });

  it('still asks the fallback for a plan that is not step-free, and says why', async () => {
    const { provider, other } = routing(ACCESS);
    const early = { ...RIDE, stepFree: false, arriveBy: new Date('2026-11-11T00:20:00-05:00') };
    const outcome = await provider.plan(early);
    expect(other.calls()).toBe(1);
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.provenance.sourceId).toBe('transitous');
    expect(outcome.provenance.evidence).toMatch(/^moviq-raptor had no answer \(no-itineraries: /);
  });

  it('leaves a cancelled live trip out, and gives both reasons when the fallback fails too', async () => {
    const feed = {
      feedTime: '2026-11-11T05:00:00.000Z',
      trips: [
        {
          tripId: '000650_1..S',
          routeId: '1',
          direction: 'south',
          startDate: '20261111',
          startTime: null,
          cancelled: true,
          stops: [],
          train: null,
        },
      ],
      leftOut: 0,
    };
    const served: Served = { ...ACCESS, 'mta-subway-1234567': { data: feed, version: 'f1' } };
    const { provider } = routing(served, fallback('fail'));
    const outcome = await provider.plan({ ...RIDE, stepFree: false });
    expect(outcome).toMatchObject({ ok: false, code: 'no-itineraries' });
    expect(outcome.ok ? '' : outcome.detail).toMatch(/arrives by .*\. transitous: Down\.$/);
  });

  it('does not ask the fallback for a plan its caller cancelled', async () => {
    const { provider, other } = routing(ACCESS);
    const controller = new AbortController();
    controller.abort();
    expect(await provider.plan(RIDE, controller.signal)).toMatchObject({
      ok: false,
      code: 'cancelled',
    });
    expect(other.calls()).toBe(0);
  });
});
