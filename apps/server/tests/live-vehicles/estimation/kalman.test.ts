import { describe, expect, it } from 'vitest';

import {
  correct,
  predict,
  startAt,
  type FilterParameters,
} from '../../../src/modules/live/estimation/kalman.js';

/** The bus parameters of `gps-plus.ts`. */
const BUS_FILTER: FilterParameters = { q: 0.3, r: 10, maxSpeed: 25, settleSeconds: 40 };

describe('the Kalman filter along the line', () => {
  it('predicts and corrects with the values computed by hand', () => {
    // r 10 m gives dd = 100 m²; a speed spread of 10 m/s gives vv = 100 m²/s².
    const first = startAt(0, BUS_FILTER, 10);
    expect(first).toEqual({ meters: 0, speed: 0, dd: 100, dv: 0, vv: 100 });
    // 30 s, q 0.3: dd = 100 + 30²·100 + 0.3·30³/3 = 92,800; dv = 30·100 + 0.3·30²/2 = 3,135;
    // vv = 100 + 0.3·30 = 109.
    const ahead = predict(first, 30, BUS_FILTER, null);
    expect(ahead).toEqual({ meters: 0, speed: 0, dd: 92_800, dv: 3_135, vv: 109 });
    // Report at 240 m: gains 92,800/92,900 and 3,135/92,900.
    const corrected = correct(ahead, 240, BUS_FILTER);
    expect(corrected.meters).toBeCloseTo(239.7417, 4);
    expect(corrected.speed).toBeCloseTo(8.099, 4);
    expect(corrected.dd).toBeCloseTo(99.8924, 4);
    expect(corrected.dv).toBeCloseTo(3.3746, 4);
    expect(corrected.vv).toBeCloseTo(3.2064, 4);
  });

  it('settles the speed on the typical speed of the stretch in about 40 s', () => {
    const moving = { meters: 0, speed: 10, dd: 0, dv: 0, vv: 0 };
    // v(40) = 5 + 5·e⁻¹; metres = 5·40 + 5·40·(1 − e⁻¹).
    const later = predict(moving, 40, BUS_FILTER, 5);
    expect(later.speed).toBeCloseTo(6.8394, 4);
    expect(later.meters).toBeCloseTo(326.4241, 4);
    // Without a typical speed it keeps its own.
    expect(predict(moving, 40, BUS_FILTER, null)).toMatchObject({ meters: 400, speed: 10 });
  });

  it('never gives a speed below zero or above the fastest a bus runs', () => {
    const state = { meters: 100, speed: 1, dd: 400, dv: 100, vv: 25 };
    expect(correct(state, 0, BUS_FILTER).speed).toBe(0);
    expect(correct(state, 2_000, BUS_FILTER).speed).toBe(BUS_FILTER.maxSpeed);
  });
});
