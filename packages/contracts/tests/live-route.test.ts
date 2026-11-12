import { describe, expect, it } from 'vitest';
import { liveVehicleRouteSchema } from '../src/index.js';

describe('selected vehicle route contract', () => {
  it('accepts a bounded line or a missing route', () => {
    expect(liveVehicleRouteSchema.safeParse({ coordinates: null }).success).toBe(true);
    expect(
      liveVehicleRouteSchema.safeParse({
        coordinates: [
          [-73.9, 40.7],
          [-73.8, 40.8],
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects invalid points, single points and oversized lines', () => {
    expect(liveVehicleRouteSchema.safeParse({ coordinates: [[-73.9, 40.7]] }).success).toBe(false);
    expect(
      liveVehicleRouteSchema.safeParse({
        coordinates: [
          [181, 40],
          [-73, 40],
        ],
      }).success,
    ).toBe(false);
    expect(
      liveVehicleRouteSchema.safeParse({
        coordinates: [
          [-73, 91],
          [-73, 40],
        ],
      }).success,
    ).toBe(false);
    expect(
      liveVehicleRouteSchema.safeParse({
        coordinates: Array.from({ length: 100_001 }, () => [-73, 40]),
      }).success,
    ).toBe(false);
  });
});
