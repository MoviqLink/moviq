import { z } from 'zod';

/** A point as `[longitude, latitude]`, the GeoJSON order. */
export const positionSchema = z.tuple([z.number(), z.number()]);

type Position = z.infer<typeof positionSchema>;

/** Socrata keeps the first 255 characters of `link_points`; longer lines lose their tail. */
const LINK_POINTS_LIMIT = 255;

const PAIR = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/;

/** The five boroughs with a margin, so that a point anywhere else is taken as a broken one. */
const AREA = { south: 40.4, north: 41.0, west: -74.4, east: -73.6 };

function toPosition(token: string): Position | undefined {
  const match = PAIR.exec(token);
  if (match === null) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  const inside =
    latitude >= AREA.south &&
    latitude <= AREA.north &&
    longitude >= AREA.west &&
    longitude <= AREA.east;
  return inside ? [longitude, latitude] : undefined;
}

export interface LinkPath {
  /** At least two validated points, or null when the segment has no usable line. */
  readonly path: Position[] | null;
  /** Pairs left out: cut at the end of the text, malformed or outside New York. */
  readonly dropped: number;
}

/**
 * `link_points` (`40.78795,-73.790191 40.78647,-73.78812 …`, latitude first) as validated
 * positions. The last pair of a text that reaches the cut is dropped even when it still reads
 * as numbers, because its digits may be cut short.
 */
export function parseLinkPoints(value: string | undefined): LinkPath {
  if (value === undefined) return { path: null, dropped: 0 };
  const tokens = value
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');
  const complete = value.length >= LINK_POINTS_LIMIT ? tokens.slice(0, -1) : tokens;
  const path = complete.flatMap((token) => {
    const position = toPosition(token);
    return position === undefined ? [] : [position];
  });
  return { path: path.length >= 2 ? path : null, dropped: tokens.length - path.length };
}
