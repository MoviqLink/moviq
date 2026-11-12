import { describe, expect, it } from 'vitest';

import {
  usableDistribution,
  usableMargin,
  usableSpeed,
} from '../../../src/modules/live/estimation/statistics.js';
import { RUN_TIME, recorded } from './statistics.js';

describe('answers of the recorder, checked before use', () => {
  it('takes a distribution of nine non-decreasing values from 20 measurements on', () => {
    expect(usableDistribution(RUN_TIME)).toEqual(RUN_TIME);
    expect(usableDistribution(recorded(RUN_TIME.seconds, 19))).toBeNull();
    expect(usableDistribution(null)).toBeNull();
  });

  it('counts as not measured an answer that does not match its shape', () => {
    expect(usableDistribution(recorded([60, 70, 80]))).toBeNull();
    expect(usableDistribution(recorded([60, 70, 80, 90, 100, 95, 120, 130, 140]))).toBeNull();
    expect(usableDistribution({ ...RUN_TIME, from: 'last week' })).toBeNull();
    const measured = { n: 25, from: RUN_TIME.from, to: RUN_TIME.to };
    expect(usableSpeed({ ...measured, metersPerSecond: -1 })).toBeNull();
    expect(usableSpeed({ ...measured, metersPerSecond: 6.2 })?.metersPerSecond).toBe(6.2);
    expect(usableMargin({ ...measured, p90Meters: Number.NaN })).toBeNull();
    expect(usableMargin({ ...measured, p90Meters: 70 })?.p90Meters).toBe(70);
  });
});
