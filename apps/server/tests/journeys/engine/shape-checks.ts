import { distanceMetres } from '../../../src/modules/journeys/engine/walking.js';

type Point = readonly [number, number];

/** The distance from a point to the nearest vertex of a shape, in metres. */
export function metresToShape(point: Point, shape: readonly Point[]): number {
  return Math.min(
    ...shape.map((vertex) => distanceMetres(point[1], point[0], vertex[1], vertex[0])),
  );
}

/** The index of the vertex of a shape nearest a point. */
export function nearestVertex(shape: readonly Point[], point: Point | undefined): number {
  if (point === undefined) return -1;
  const metres = shape.map((vertex) => distanceMetres(point[1], point[0], vertex[1], vertex[0]));
  return metres.indexOf(Math.min(...metres));
}
