import { describe, expect, it } from 'vitest';

import { createBusMeasures } from '../../src/modules/recorder/nightly/bus-measures.js';
import { quantileOfCounts } from '../../src/modules/recorder/nightly/statistics.js';
import { stretchOf } from '../../src/modules/recorder/nightly/stretch-speeds.js';
import { ageBand } from '../../src/modules/recorder/nightly/tracking-errors.js';
import { busDay, northOf } from './bus-day.js';

/** Both readings of the day, as both recorders read it. */
function measured() {
  const buses = createBusMeasures('weekday');
  for (const event of busDay()) buses.add('mta-bus-positions', event);
  buses.replay();
  for (const event of busDay()) buses.add('mta-bus-positions', event);
  return { speeds: [...buses.speeds(7)].flat(), tracking: buses.tracking() };
}

describe('the speed of buses by stretch of street', () => {
  it('counts each move of 30 s at the stretch of its middle, by route, band and day', () => {
    const { speeds } = measured();
    // 19 moves of 300 m on one street, each in its own stretch, by 25 buses; none standing.
    expect(speeds).toHaveLength(19);
    for (const row of speeds) {
      expect(row).toMatchObject({ mode: 'bus', route: 'M15', band: 'am-peak', n: 25 });
      expect(row.dayType).toBe('weekday');
      expect(quantileOfCounts(row.counts, 0.5)).toBeCloseTo(10, 0);
    }
    expect(speeds.map((row) => row.stretch)).toContain(stretchOf(northOf(150), 0));
  });

  it('keeps the heading: the same place crossed the other way is another stretch', () => {
    expect(stretchOf(northOf(150), 0)).not.toBe(stretchOf(northOf(150), 180));
    // Manhattan's avenues run at 29°: inside the stretch heading north.
    expect(stretchOf(northOf(150), 29)).toBe(stretchOf(northOf(150), 0));
  });
});

describe('the replayed error of gps-plus positions', () => {
  it('judges each report against where the bus would have been drawn, by age', () => {
    const { tracking } = measured();
    const band = (from: number) => tracking.find((row) => row.ageFrom === from);
    // Every report after the first one of each bus, at 30 s: 25 × 19.
    const thirty = band(30);
    expect(thirty).toMatchObject({ route: 'M15', ageTo: 45, n: 25 * 19 });
    // Steady at the typical speed of each stretch, the filter draws the bus where it reports;
    // the first move of each bus, from a filter that does not know its speed yet, is 300 m off
    // (just over, on coordinates of five decimals), counted in steps of 5 m rounded up.
    expect(quantileOfCounts(thirty?.counts ?? [], 0.9)).toBeLessThanOrEqual(5);
    expect(thirty?.counts.at(-1)).toEqual([305, 25]);
    // Ten reports back at most, and five minutes at most.
    expect(band(240)?.ageTo).toBe(300);
    expect(tracking.every((row) => row.ageTo <= 300)).toBe(true);
  });

  it('keeps ages in bands that end at the five minutes the estimator follows', () => {
    expect(ageBand(10)).toBe(0);
    expect(ageBand(30)).toBe(2);
    expect(ageBand(300)).toBe(8);
    expect(ageBand(301)).toBeUndefined();
    expect(ageBand(0)).toBeUndefined();
  });
});
