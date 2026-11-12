import { z } from 'zod';

import type { KnownFailure, Licence } from '../../definition.js';
import { httpFailures } from '../regional/provider-failures.js';

/** The data routes of 511NY's own map (`demo.511ny.org/configs/main.json`); no key. */
export const NY511_API = 'https://api-511x-nysdot.carsprogram.org/';

export const NY511_PROVIDER = 'New York State DOT, 511NY';

/**
 * The 511NY Developer Access Agreement allows the data to be redistributed and repackaged, as
 * long as the meaning of each event stays as NYSDOT published it, the time of its publication or
 * last update is shown wherever it is presented, and "511NY" is not used as a brand. Its data
 * comes "as is", without warranty, and that disclaimer travels with it.
 */
export const NY511_LICENCE: Licence = {
  name: '511NY Developer Access Agreement',
  url: 'https://511ny.org/developers/daa',
  attribution: 'Powered by 511NY',
};

/**
 * The five boroughs and their approaches: the Hudson crossings in New Jersey (Newark airport,
 * Goethals, Outerbridge, Bayonne, Holland, Lincoln, George Washington) and the first exits in
 * Westchester and Nassau.
 */
const CITY_AREA = { south: 40.49, north: 40.92, west: -74.27, east: -73.68 } as const;

const position = z
  .array(z.number())
  .min(2)
  .transform(([lon = Number.NaN, lat = Number.NaN]): [number, number] => [lon, lat])
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]));

/** GeoJSON geometry of a map feature, with each position cut to longitude and latitude. */
export const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(position).min(2)) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4)) }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(z.array(position).min(4))),
  }),
]);

export type Geometry = z.infer<typeof geometrySchema>;
type Position = readonly [number, number];

function positionsOf(geometry: Geometry): readonly Position[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates];
    case 'LineString':
      return geometry.coordinates;
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates.flat();
    case 'MultiPolygon':
      return geometry.coordinates.flat(2);
  }
}

export function inCityArea([lon, lat]: Position): boolean {
  return (
    lat >= CITY_AREA.south &&
    lat <= CITY_AREA.north &&
    lon >= CITY_AREA.west &&
    lon <= CITY_AREA.east
  );
}

/**
 * A feature is kept when its extent overlaps the city area, so a warning area that covers the
 * whole city is kept even when none of its corners lies in it.
 */
export function touchesCityArea(geometry: Geometry): boolean {
  const positions = positionsOf(geometry);
  const lons = positions.map(([lon]) => lon);
  const lats = positions.map(([, lat]) => lat);
  return (
    Math.min(...lats) <= CITY_AREA.north &&
    Math.max(...lats) >= CITY_AREA.south &&
    Math.min(...lons) <= CITY_AREA.east &&
    Math.max(...lons) >= CITY_AREA.west
  );
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntity(entity: string, name: string): string {
  if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
  if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
  return ENTITIES[name] ?? entity;
}

/** 511NY wraps descriptions in HTML (`<div>`, `<p>`, `<span>`): its words, without the markup. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clocks may differ a little; a time further ahead than this is from a wrong clock. */
const CLOCK_TOLERANCE_MS = 2 * 60_000;

export function aheadOf(time: number, receivedAt: Date): boolean {
  return time - receivedAt.getTime() > CLOCK_TOLERANCE_MS;
}

/** The failures of any 511NY map layer, with what an operator does about each. */
export function ny511Failures(minimum: string): readonly KnownFailure[] {
  return [
    ...httpFailures('511NY (api-511x-nysdot.carsprogram.org)', 'https://511ny.org/help/24'),
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page of the CDN',
      state: 'degraded',
      remedy: 'Keep the last good layer with its age; the next run tries again',
    },
    {
      code: 'unexpected-shape',
      detection: 'Not a list of map features with the fields of 511NY map layers',
      state: 'misconfigured',
      remedy:
        'Compare with the capture and the layer in the map configuration, then update the reader',
    },
    {
      code: 'check-failed',
      detection: minimum,
      state: 'degraded',
      remedy: 'Refused, so a cut layer never reads as the whole state',
    },
  ];
}
