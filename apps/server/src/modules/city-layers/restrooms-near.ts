import {
  MAX_RESTROOM_POINTS,
  toInstant,
  type NearRestroom,
  type RestroomAccess,
  type RestroomsNearResponse,
} from '@moviq/contracts';
import { z } from 'zod';

import type { SourceReader } from '../data-platform/reader.js';
import {
  nycPublicRestrooms,
  type PublicRestroom,
} from '../data-platform/sources/street/public-restrooms.js';
import { distanceMeters, type Point } from '../live/geo.js';
import { liveSource } from '../live/sources.js';

/** About ten minutes on foot, in a straight line: farther is not "on the way". */
const WITHIN_METRES = 800;

/** One point asked gets three restrooms; each stop of a trip, two. */
const perPoint = (points: number): number => (points === 1 ? 3 : 2);

/** Fully accessible first on a step-free trip, then partly, then not said, then not accessible. */
const ACCESS_RANK: Readonly<Record<RestroomAccess | 'unknown', number>> = {
  full: 0,
  partial: 1,
  limited: 1,
  unknown: 2,
  none: 3,
};

const rankOf = (restroom: PublicRestroom, stepFree: boolean): number =>
  stepFree ? ACCESS_RANK[restroom.facts.access ?? 'unknown'] : 0;

/** A straight line said to the nearest 10 m: never more precise than a line on a map. */
const roundMetres = (metres: number): number => Math.max(10, Math.round(metres / 10) * 10);

/**
 * The restrooms nearest to each point, in the order of the points, within `WITHIN_METRES` in a
 * straight line; one near two points is listed once, at the first. With `stepFree`, the fully
 * accessible ones come before the nearer ones that are not.
 */
export function nearestRestrooms(
  restrooms: readonly PublicRestroom[],
  points: readonly Point[],
  stepFree: boolean,
): NearRestroom[] {
  const taken = new Set<PublicRestroom>();
  return points.flatMap((point, near) => {
    const [lon, lat] = [point.lon, point.lat];
    const found = restrooms
      .filter((restroom) => !taken.has(restroom))
      .map((restroom) => ({
        restroom,
        metres: distanceMeters({ lat, lon }, { lat: restroom.point[1], lon: restroom.point[0] }),
      }))
      .filter(({ metres }) => metres <= WITHIN_METRES)
      .sort(
        (a, b) =>
          rankOf(a.restroom, stepFree) - rankOf(b.restroom, stepFree) || a.metres - b.metres,
      )
      .slice(0, perPoint(points.length));
    return found.map(({ restroom, metres }) => {
      taken.add(restroom);
      return {
        name: restroom.name,
        point: restroom.point,
        facts: restroom.facts,
        near,
        straightMetres: roundMetres(metres),
      };
    });
  });
}

/** The restrooms near the points, read from the platform with the list's source and age. */
export async function restroomsNear(
  reader: SourceReader,
  points: readonly Point[],
  stepFree: boolean,
  now: Date,
): Promise<RestroomsNearResponse> {
  const reading = await reader.read(nycPublicRestrooms);
  const list = reading.data?.restrooms;
  return {
    generatedAt: toInstant(now),
    stepFree,
    withinMetres: WITHIN_METRES,
    restrooms: list === undefined ? null : nearestRestrooms(list, points, stepFree),
    source: liveSource(nycPublicRestrooms, reading),
  };
}

const pointSchema = z
  .string()
  .transform((pair) => pair.split(',').map(Number))
  .pipe(z.tuple([z.number().min(40.4).max(41.1), z.number().min(-74.4).max(-73.6)]))
  .transform(([lat, lon]): Point => ({ lat, lon }));

/** `lat,lon;lat,lon`: one to four points in the city area, or null when it is not that. */
export function pointsOf(value: string | undefined): readonly Point[] | null {
  const parsed = pointSchema
    .array()
    .min(1)
    .max(MAX_RESTROOM_POINTS)
    .safeParse((value ?? '').split(';'));
  return parsed.success ? parsed.data : null;
}
