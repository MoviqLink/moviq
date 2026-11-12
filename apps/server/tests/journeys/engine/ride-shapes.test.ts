import { describe, expect, it } from 'vitest';

import { encodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { ridePath, type RideShapes } from '../../../src/modules/journeys/engine/ride-shapes.js';

type Point = readonly [number, number];

const shapeOf = (points: readonly Point[]): RideShapes => ({
  lines: [encodePolyline(points.map(([lon, lat]) => ({ lon, lat })))],
  ofTrip: Int32Array.from([0, -1]),
});

/** East along 40.700, a turn 44 m north, back west along 40.7004, then north. */
const LOOP: readonly Point[] = [
  [-74.0, 40.7],
  [-73.99, 40.7],
  [-73.99, 40.7004],
  [-74.0, 40.7004],
  [-74.0, 40.71],
];

describe('the way of a ride along its shape', () => {
  it('cuts the shape from the stop boarded to the stop left, beginning and ending at both', () => {
    const stops: Point[] = [
      [-74.0, 40.70002],
      [-73.995, 40.70001],
      [-73.99, 40.70002],
    ];
    expect(ridePath(shapeOf(LOOP), 0, stops, 1)).toEqual([
      [-73.995, 40.70001],
      [-73.995, 40.7],
      [-73.99, 40.7],
      [-73.99, 40.70002],
    ]);
  });

  it('meets the stops in order, so a line passing a stop again later is cut where it calls', () => {
    // The third stop is 44 m from the first pass too, but the trip calls there on its way back.
    const stops: Point[] = [
      [-74.0, 40.7],
      [-73.99, 40.7],
      [-74.0, 40.7004],
      [-74.0, 40.71],
    ];
    expect(ridePath(shapeOf(LOOP), 0, stops, 2)).toEqual([
      [-74.0, 40.7004],
      [-74.0, 40.71],
    ]);
  });

  it('has no way for a trip without a shape, or with a stop off it, so the stops are used', () => {
    const stops: Point[] = [
      [-74.0, 40.7],
      [-73.99, 40.7],
    ];
    expect(ridePath(shapeOf(LOOP), 1, stops, 0)).toBeUndefined();
    const off: Point[] = [stops[0] ?? [0, 0], [-73.99, 40.702]];
    expect(ridePath(shapeOf(LOOP.slice(0, 2)), 0, off, 0)).toBeUndefined();
  });
});
