import { describe, expect, it } from 'vitest';
import type { Line } from '../../src/modules/live/estimation/line.js';
import { subwaySegment } from '../../src/modules/live/subway-segment.js';
import type { Timetable } from '../../src/modules/live/timetable.js';

const line: Line = {
  id: 'N..N1',
  points: [
    { lat: 40.7, lon: -73.9 },
    { lat: 40.71, lon: -73.9 },
    { lat: 40.72, lon: -73.9 },
  ],
  at: [0, 1112, 2224],
  length: 2224,
};
function table(lines: readonly Line[]): Timetable {
  return {
    sources: [],
    route: () => undefined,
    stop: () => undefined,
    trip: () => undefined,
    tripsForRoute: () => [],
    line: (id) => lines.find((item) => item.id === id),
    *shapeIds() {
      for (const item of lines) yield item.id;
    },
  };
}

describe('verified subway segment', () => {
  it('trims a published shared track to stops in travel order', () => {
    const segment = subwaySegment(
      '123_W..N',
      [line.points[0], line.points[1] ?? line.points[0]],
      table([line]),
    );
    expect(segment?.points[0]).toEqual(line.points[0]);
    expect(segment?.length).toBeCloseTo(1112);
    expect(segment?.points.at(-1)).toEqual(line.points[1]);
  });
  it('rejects reversed, distant or ambiguous tracks instead of inventing a route', () => {
    const start = line.points[0];
    const end = line.points[1] ?? line.points[0];
    expect(subwaySegment('123_W..N', [end, start], table([line]))).toBeUndefined();
    expect(
      subwaySegment('123_W..N', [start, { lat: 41, lon: -74 }], table([line])),
    ).toBeUndefined();
    const detour: Line = {
      ...line,
      id: 'Q..N1',
      points: [start, { lat: 40.705, lon: -73.898 }, end],
      at: [0, 600, 1200],
      length: 1200,
    };
    expect(subwaySegment('123_W..N', [start, end], table([line, detour]))).toBeUndefined();
  });
});
