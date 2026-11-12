import { describe, expect, it } from 'vitest';

import {
  bandOf,
  dayTypeOf,
  hoursOfDay,
  shiftDay,
} from '../../src/modules/recorder/nightly/calendar.js';
import {
  countValues,
  mergeCounts,
  quantile,
  quantileOfCounts,
} from '../../src/modules/recorder/nightly/statistics.js';
import { kaplanMeier } from '../../src/modules/recorder/nightly/survival.js';

describe('quantile', () => {
  it('interpolates between order statistics (type 7)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.1)).toBeCloseTo(1.3, 10);
    expect(quantile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 10);
    expect(quantile([10, 20, 30, 40, 50], 0.1)).toBeCloseTo(14, 10);
    expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 10);
    expect(quantile([7], 0.9)).toBe(7);
  });

  it('refuses an empty list instead of inventing a value', () => {
    expect(() => quantile([], 0.5)).toThrow('at least one value');
  });

  it('gives the same answer over counted values without expanding them', () => {
    expect(quantileOfCounts(countValues([1, 2, 3, 4]), 0.5)).toBe(2.5);
    expect(
      quantileOfCounts(
        [
          [5, 3],
          [9, 1],
        ],
        0.5,
      ),
    ).toBe(5);
    expect(
      quantileOfCounts(
        [
          [5, 3],
          [9, 1],
        ],
        0.9,
      ),
    ).toBeCloseTo(7.8, 10);
    const merged = mergeCounts([countValues([3, 1]), countValues([2, 4])]);
    expect(merged).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
  });
});

describe('kaplanMeier', () => {
  it('counts open incidents as at risk until the time they have lasted so far', () => {
    const curve = kaplanMeier([
      { seconds: 1, closed: true },
      { seconds: 2, closed: false },
      { seconds: 3, closed: true },
      { seconds: 4, closed: true },
      { seconds: 5, closed: false },
    ]);
    // S(1) = 4/5; S(3) = 0.8 × 2/3; S(4) = that × 1/2. The open ones at 2 and 5 never close.
    expect(curve.points.map(([time]) => time)).toEqual([1, 3, 4]);
    expect(curve.points[0]?.[1]).toBeCloseTo(0.8, 10);
    expect(curve.points[1]?.[1]).toBeCloseTo(0.8 * (2 / 3), 10);
    expect(curve.points[2]?.[1]).toBeCloseTo(0.8 * (2 / 3) * 0.5, 10);
    expect(curve.p50).toBe(4);
    expect(curve.p90).toBeNull();
    expect({ n: curve.n, closed: curve.closed, open: curve.open }).toEqual({
      n: 5,
      closed: 3,
      open: 2,
    });
  });

  it('keeps an open incident at risk at the time of a tie', () => {
    const curve = kaplanMeier([
      { seconds: 2, closed: true },
      { seconds: 2, closed: true },
      { seconds: 2, closed: false },
      { seconds: 6, closed: true },
    ]);
    expect(curve.points).toEqual([
      [2, 0.5],
      [6, 0],
    ]);
    expect(curve.p50).toBe(2);
    expect(curve.p90).toBe(6);
  });

  it('is the plain empirical curve when every incident closed', () => {
    const curve = kaplanMeier([10, 20, 30, 40].map((seconds) => ({ seconds, closed: true })));
    expect(curve.points).toEqual([
      [10, 0.75],
      [20, 0.5],
      [30, 0.25],
      [40, 0],
    ]);
    expect(curve.p50).toBe(20);
  });
});

describe('the New York calendar', () => {
  it('puts instants in bands by New York time', () => {
    expect(bandOf(new Date('2026-11-11T12:30:00.000Z'))).toBe('am-peak');
    expect(bandOf(new Date('2026-11-11T22:00:00.000Z'))).toBe('pm-peak');
    expect(bandOf(new Date('2026-11-12T06:59:00.000Z'))).toBe('night');
  });

  it('knows the kind of each day and the hours it has', () => {
    expect(dayTypeOf('2026-11-11')).toBe('weekday');
    expect(dayTypeOf('2026-11-14')).toBe('saturday');
    expect(dayTypeOf('2026-11-15')).toBe('sunday');
    expect(hoursOfDay('2026-11-11')).toHaveLength(24);
    expect(hoursOfDay('2026-03-08')).toHaveLength(23);
    expect(hoursOfDay('2026-11-01')).toHaveLength(24);
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});
