import { describe, expect, it } from 'vitest';

import {
  recordTrails,
  TRAIL_MS,
  trailFeatures,
  type Trails,
} from '../../src/features/explore/map/trails';

const at = (id: string, lon: number) => new Map([[id, [lon, 40.75] as const]]);

describe('vehicle trails', () => {
  it('keeps only the points drawn in the last stretch of time', () => {
    const trails: Trails = new Map();
    expect(recordTrails(trails, at('subway:1', -73.99), 0)).toBe(true);
    expect(recordTrails(trails, at('subway:1', -73.99), 1_000)).toBe(false);
    recordTrails(trails, at('subway:1', -73.98), 2_000);
    recordTrails(trails, at('subway:1', -73.97), TRAIL_MS + 1_500);
    expect(trails.get('subway:1')?.map((point) => point.at[0])).toEqual([-73.98, -73.97]);
  });

  it('settles once a stopped vehicle has nothing left to fade', () => {
    const trails: Trails = new Map();
    recordTrails(trails, at('rail:1', -73.99), 0);
    recordTrails(trails, at('rail:1', -73.98), 1_000);
    expect(recordTrails(trails, at('rail:1', -73.98), TRAIL_MS * 2)).toBe(true);
    expect(recordTrails(trails, at('rail:1', -73.98), TRAIL_MS * 2 + 100)).toBe(false);
    expect(trails.get('rail:1')).toHaveLength(1);
  });

  it('forgets vehicles no longer drawn and cuts each trail into fading steps', () => {
    const trails: Trails = new Map();
    recordTrails(trails, at('bus:1', -73.99), 0);
    recordTrails(trails, at('bus:1', -73.98), 15_000);
    recordTrails(trails, at('bus:1', -73.97), 29_000);
    const lines = trailFeatures(trails, new Map([['bus:1', 'bus']]), 29_000).features;
    expect(lines.map((line) => line.properties.step)).toEqual([1, 2]);
    expect(lines.every((line) => line.properties.mode === 'bus')).toBe(true);
    expect(recordTrails(trails, new Map(), 30_000)).toBe(true);
    expect(trails.size).toBe(0);
  });
});
