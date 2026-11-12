import { describe, expect, it } from 'vitest';

import { ageBand, agePosition, currentLimit, liveAge } from '../src/features/ops/model/age';
import { ageLook } from '../src/features/ops/model/states';

const freshness = {
  degradedAfterSeconds: 60,
  staleAfterSeconds: 180,
  unavailableAfterSeconds: 600,
};
const dataTime = '2026-11-11T14:00:00.000Z';
const t0 = Date.parse(dataTime);

describe('age of the data', () => {
  it('grows with the browser clock from the data time, without a new answer', () => {
    expect(liveAge(dataTime, t0 + 18_000)).toBe(18);
    expect(liveAge(dataTime, t0 + 19_000)).toBe(19);
    expect(liveAge(dataTime, t0 + 3_600_000)).toBe(3_600);
  });

  it('is unknown, not zero, when the source never delivered data', () => {
    expect(liveAge(null, t0)).toBeNull();
  });

  it('never goes below zero when the browser clock is a little behind', () => {
    expect(liveAge(dataTime, t0 - 2_000)).toBe(0);
  });

  it('falls in the band of the limit it has passed', () => {
    expect(ageBand(59, freshness)).toBe('fresh');
    expect(ageBand(60, freshness)).toBe('degraded');
    expect(ageBand(180, freshness)).toBe('stale');
    expect(ageBand(600, freshness)).toBe('unavailable');
  });

  it('is measured against the next limit it will cross', () => {
    expect(currentLimit(18, freshness)).toBe(60);
    expect(currentLimit(95, freshness)).toBe(180);
    expect(currentLimit(400, freshness)).toBe(600);
    expect(currentLimit(9_000, freshness)).toBe(600);
  });

  it('places the dot along the line and stops it at the end', () => {
    expect(agePosition(300, freshness)).toBe(0.5);
    expect(agePosition(6_000, freshness)).toBe(1);
  });

  it('takes the colour of the band it is in, except outside the service period', () => {
    expect(ageLook('healthy', 18, freshness)).toBe('healthy');
    expect(ageLook('degraded', 400, freshness)).toBe('stale');
    expect(ageLook('outside_service', 14_400, freshness)).toBe('outside_service');
  });
});
