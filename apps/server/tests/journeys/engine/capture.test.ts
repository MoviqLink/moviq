import type { Place } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import type { LiveTrip } from '../../../src/modules/journeys/engine/inputs.js';
import { SUBWAY_TIMETABLE } from '../../../src/modules/journeys/engine/live-sources.js';
import { createEngineRouting } from '../../../src/modules/journeys/engine/provider.js';
import type { RouteQuery } from '../../../src/modules/journeys/ports.js';
import { CAPTURED_AT, capture } from '../../sources/mta/captures.js';
import { decodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { timetableFromGtfs } from './gtfs-capture.js';
import { predictionReading, provenance, sources, summary } from './hand-network.js';
import { metresToShape, nearestVertex } from './shape-checks.js';

/**
 * The subway capture of 11/11/2026 keeps the stop times of three weekday trips: two 1 trains
 * from Van Cortlandt Park-242 St (00:06:30 and 00:25:30) and a 2 train from Wakefield-241 St
 * (00:19:00). Every expected time below is read from its `stop_times.txt`.
 */
const subway = timetableFromGtfs(SUBWAY_TIMETABLE, capture('gtfs_subway.zip'), CAPTURED_AT);

/** Wednesday 11 November 2026 in New York (EST, UTC-5). */
function wednesday(clock: string): Date {
  return new Date(`2026-11-11T${clock}-05:00`);
}

function station(stopId: string, label: string, lat: number, lon: number): Place {
  return { label, lat, lon, kind: 'station', stopId };
}

const VAN_CORTLANDT = station('101', 'Van Cortlandt Park-242 St', 40.889248, -73.898583);
const TIMES_SQUARE = station('127', 'Times Sq-42 St', 40.75529, -73.987495);
const WALL_STREET = station('230', 'Wall St', 40.706821, -74.0091);

function engine(live: readonly LiveTrip[] = []) {
  return createEngineRouting({
    sources: sources(
      [
        {
          sourceId: SUBWAY_TIMETABLE,
          version: 'capture',
          provenance: provenance(SUBWAY_TIMETABLE),
          timetable: subway,
        },
      ],
      live.length === 0
        ? []
        : [predictionReading({ timetables: [SUBWAY_TIMETABLE], rule: 'mta-subway', trips: live })],
    ),
    clock: { now: () => wednesday('00:00:00') },
  });
}

function trip(from: Place, to: Place, arriveBy: string): RouteQuery {
  const at = wednesday(arriveBy);
  return {
    from,
    to,
    arriveBy: at,
    modes: ['subway'],
    maxWalkMinutes: 0,
    stepFree: false,
    count: 3,
  };
}

describe('the engine on the real MTA subway capture', () => {
  it('rides the 00:06:30 1 train to Times Square to arrive by 00:50', async () => {
    const outcome = await engine().plan(trip(VAN_CORTLANDT, TIMES_SQUARE, '00:50:00'));
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.value).toHaveLength(1);
    const [leg] = outcome.value[0]?.legs ?? [];
    // 101S at 00:06:30, 127S arriving 00:43:30 (it leaves at 00:45:30): sequences 1 and 25.
    expect(leg).toMatchObject({
      mode: 'subway',
      tripId: 'AFA26GEN-1095-Weekday-00_000650_1..S15R',
      route: { id: '1', shortName: '1', headsign: 'South Ferry' },
      departAt: new Date('2026-11-11T05:06:30.000Z'),
      arriveAt: new Date('2026-11-11T05:43:30.000Z'),
      scheduled: true,
    });
    expect(leg?.from).toMatchObject({ stopId: '101S', label: 'Van Cortlandt Park-242 St' });
    expect(leg?.to).toMatchObject({ stopId: '127S', label: 'Times Sq-42 St' });
    // Along the shape 1..S15R of `shapes.txt` from 101S to 127S, not straight between the stops.
    const shape = (decodePolyline(subway.shapes['1..S15R'] ?? '') ?? []).map(
      (point): [number, number] => [point.lon, point.lat],
    );
    const path = leg?.path ?? [];
    expect(path.length).toBeGreaterThan(100);
    expect(path[0]).toEqual([-73.898583, 40.889248]);
    expect(path.at(-1)).toEqual([-73.987495, 40.75529]);
    expect(path.every((point) => metresToShape(point, shape) < 1)).toBe(true);
    const [first, last] = [nearestVertex(shape, path[0]), nearestVertex(shape, path.at(-1))];
    expect(path).toEqual(expect.arrayContaining(shape.slice(first + 1, last)));
    // The capture keeps 58 trips but the stop times of 3: the others are counted, never guessed.
    expect(outcome.provenance.evidence).toContain(
      'left out of the network: 55 trip without stop times',
    );
  });

  it('changes from the 1 to the 2 where the change leaves the most time, to reach Wall St', async () => {
    const outcome = await engine().plan(trip(VAN_CORTLANDT, WALL_STREET, '01:40:00'));
    if (!outcome.ok) throw new Error(outcome.detail);
    // Both trains call at 120S to 137S. At Times Sq the 1 arrives 01:02:30 and the 2 leaves
    // 01:17:00: 13:30 to spare after the minute to change, the most of any shared stop (11:30
    // elsewhere). The earlier 1 train would also connect but leaves earlier: not on the front.
    expect(outcome.value.map((itinerary) => summary(itinerary.legs))).toEqual([
      ['subway 1 101S 00:25:30 > 127S 01:02:30', 'subway 2 127S 01:17:00 > 230S 01:34:00'],
    ]);
    expect(outcome.value[0]?.legs[1]?.tripId).toBe('AFA26GEN-2102-Weekday-00_001900_2..S15R');
  });

  it('matches a subway live trip id to its timetable trip and rides its predicted times', async () => {
    const at = (clock: string): string => wednesday(clock).toISOString();
    const delayed: LiveTrip = {
      tripId: '002550_1..S',
      startDate: '20261111',
      cancelled: false,
      stops: [
        { stopId: '101S', sequence: null, arrival: at('00:28:30'), departure: at('00:28:30') },
        { stopId: '127S', sequence: null, arrival: at('01:05:30'), departure: at('01:07:30') },
      ],
    };
    const outcome = await engine([delayed]).plan(trip(VAN_CORTLANDT, TIMES_SQUARE, '01:10:00'));
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(summary(outcome.value[0]?.legs ?? [])).toEqual([
      'subway 1 101S 00:28:30 > 127S 01:05:30 live',
    ]);
    expect(outcome.value[0]?.legs[0]?.tripId).toBe('AFA26GEN-1095-Weekday-00_002550_1..S15R');
    expect(outcome.provenance.evidence).toContain('1 trips predicted');
  });

  it('says why step-free plans cannot be made on the MTA subway timetable', async () => {
    const outcome = await engine().plan({
      ...trip(VAN_CORTLANDT, TIMES_SQUARE, '00:50:00'),
      stepFree: true,
    });
    expect(outcome).toMatchObject({ ok: false, code: 'no-step-free-data' });
  });
});
