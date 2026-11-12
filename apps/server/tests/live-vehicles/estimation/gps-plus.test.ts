import { describe, expect, it } from 'vitest';

import {
  filterFor,
  follow,
  metersAt,
  type GpsTrack,
} from '../../../src/modules/live/estimation/gps-plus.js';
import { place, pointAt } from '../../../src/modules/live/estimation/line.js';
import { north, straightLine } from './lines.js';

const line = straightLine('Q050216', 5_000);
const T0 = Date.parse('2026-11-11T01:00:00Z');
const BUS = filterFor('bus');

type GpsReport = Parameters<typeof follow>[1];

function report(meters: number, seconds: number, changes: Partial<GpsReport> = {}): GpsReport {
  return {
    route: 'Q5',
    direction: 0,
    line,
    point: north(meters),
    at: T0 + seconds * 1000,
    ...changes,
  };
}

function followed(track: GpsTrack | undefined, next: GpsReport) {
  const result = follow(track, next, null, BUS);
  if (result === undefined) throw new Error('report off its line');
  return result;
}

describe('a line from a shape', () => {
  it('places a point on it, gives the point at a distance and holds to its ends', () => {
    expect(line.length).toBeCloseTo(5_000, 0);
    const beside = { lat: 40 + 555.98 / 111_195.08, lon: -73.999 };
    const placement = place(line, beside);
    expect(placement.meters).toBeCloseTo(555.98, 0);
    // 0.001° of longitude at 40° N is 85.2 m.
    expect(placement.offsetMeters).toBeCloseTo(85.2, 0);
    // Shapes keep five decimals, 1.1 m of latitude.
    expect(pointAt(line, 555.98).lat).toBeCloseTo(beside.lat, 4);
    expect(pointAt(line, -50)).toEqual(line.points[0]);
    expect(pointAt(line, 99_999).lat).toBeCloseTo(north(5_000).lat, 4);
  });
});

describe('GPS+ along the line', () => {
  it('starts on the first report and corrects itself with the next, as by hand', () => {
    const first = followed(undefined, report(0, 0));
    expect(first.restart).toBe('first');
    const second = followed(first.track, report(240, 30));
    expect(second.restart).toBeNull();
    expect(second.track.filter.meters).toBeCloseTo(239.74, 1);
    expect(second.track.filter.speed).toBeCloseTo(8.1, 1);
  });

  it('never draws a vehicle behind where it was drawn, even when a report falls behind', () => {
    const second = followed(followed(undefined, report(0, 0)).track, report(240, 30));
    const ahead = metersAt(second.track, line, T0 + 50_000, null, undefined, BUS);
    expect(ahead.meters).toBeGreaterThan(300);
    // GPS noise: the next report is 20 m behind the last.
    const noisy = followed(ahead.track, report(220, 60));
    expect(noisy.restart).toBeNull();
    const later = metersAt(noisy.track, line, T0 + 61_000, null, undefined, BUS);
    expect(later.meters).toBeGreaterThanOrEqual(ahead.meters);
  });

  it('stops at the next stop until the operator expects it to leave', () => {
    const second = followed(followed(undefined, report(0, 0)).track, report(240, 30));
    const stop = { meters: 300, leavesAt: T0 + 90_000 };
    expect(metersAt(second.track, line, T0 + 60_000, null, stop, BUS).meters).toBe(300);
    expect(metersAt(second.track, line, T0 + 90_000, null, stop, BUS).meters).toBe(300);
    // 10 s after leaving at its speed of 8.1 m/s.
    const left = metersAt(second.track, line, T0 + 100_000, null, stop, BUS);
    expect(left.meters).toBeCloseTo(300 + 81, 0);
  });

  it('takes two reports within 8 m as the vehicle standing', () => {
    const moving = followed(followed(undefined, report(0, 0)).track, report(240, 30));
    const standing = followed(moving.track, report(245, 60));
    expect(standing.track.filter.speed).toBe(0);
    expect(metersAt(standing.track, line, T0 + 120_000, null, undefined, BUS).meters).toBeCloseTo(
      Math.max(standing.track.filter.meters, moving.track.drawn),
      6,
    );
  });

  it('starts again on an impossible jump: more than 500 m, another line or direction, a gap', () => {
    const second = followed(followed(undefined, report(0, 0)).track, report(240, 30));
    // Expected near 483 m at 60 s; reported at 1,300 m.
    const jumped = followed(second.track, report(1_300, 60));
    expect(jumped.restart).toBe('jump');
    expect(jumped.track.drawn).toBeCloseTo(1_300, 0);
    const otherLine = straightLine('Q050217', 5_000);
    expect(followed(second.track, report(480, 60, { line: otherLine })).restart).toBe('other-line');
    expect(followed(second.track, report(480, 60, { direction: 1 })).restart).toBe('other-line');
    expect(followed(second.track, report(480, 60, { route: 'Q4' })).restart).toBe('other-line');
    expect(followed(second.track, report(2_400, 400)).restart).toBe('gap');
  });

  it('leaves a report more than 100 m off its line unplaced', () => {
    const off = { ...report(0, 0), point: { lat: 40.001, lon: -73.998 } };
    expect(follow(undefined, off, null, BUS)).toBeUndefined();
  });

  it('ignores a report it has already followed', () => {
    const second = followed(followed(undefined, report(0, 0)).track, report(240, 30));
    expect(followed(second.track, report(240, 30)).track).toBe(second.track);
  });
});
