import { describe, expect, it } from 'vitest';
import type { Timetable } from '../../src/modules/live/timetable.js';
import { railLine } from '../../src/modules/live/rail-line.js';
import type { Line } from '../../src/modules/live/estimation/line.js';

const shape: Line = {
  id: 'shape-a',
  points: [
    { lat: 40.7, lon: -73.9 },
    { lat: 40.71, lon: -73.9 },
  ],
  at: [0, 1112],
  length: 1112,
};
const other: Line = { ...shape, id: 'shape-b' };
const trip = {
  route: '1',
  service: 'day',
  headsign: null,
  shortName: '123',
  direction: 0 as const,
  shape: 'shape-a',
};
function timetable(direct: boolean, ambiguous = false): Timetable {
  return {
    sources: [],
    route: () => undefined,
    stop: () => undefined,
    trip: () => (direct ? trip : undefined),
    tripsForRoute: () => (ambiguous ? [trip, { ...trip, shape: 'shape-b' }] : [trip]),
    line: (id) => (id === shape.id ? shape : id === other.id ? other : undefined),
    *shapeIds() {
      yield shape.id;
      yield other.id;
    },
  };
}
const nearby = [
  { lat: 40.7, lon: -73.9 },
  { lat: 40.71, lon: -73.9 },
];

describe('railway route association', () => {
  it('uses a matching exact trip even with one stop or an off-route position', () => {
    expect(railLine(timetable(true), 'trip', null, '1', 0, [{ lat: 41, lon: -74 }])).toBe(shape);
  });
  it('matches inferred trips only when stops confirm one shape', () => {
    expect(railLine(timetable(false), 'unknown', '123', '1', 0, nearby)).toBe(shape);
    expect(railLine(timetable(false, true), 'unknown', '123', '1', 0, nearby)).toBeUndefined();
    expect(
      railLine(timetable(false), 'unknown', '123', '1', 0, nearby.slice(0, 1)),
    ).toBeUndefined();
    expect(railLine(timetable(false), 'unknown', '123', '1', 1, nearby)).toBeUndefined();
  });
});
