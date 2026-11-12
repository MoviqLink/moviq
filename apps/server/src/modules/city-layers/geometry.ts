import type { BoundingBox, CityItem } from '@moviq/contracts';

import type { Geometry } from '../data-platform/sources/ny511/provider.js';

type LonLat = readonly [number, number];

/** Where a geometry is drawn: its mark and the lines it covers (a polygon by its outline). */
export function placeOf(geometry: Geometry): Pick<CityItem, 'point' | 'lines'> {
  switch (geometry.type) {
    case 'Point':
      return { point: [...geometry.coordinates], lines: [] };
    case 'LineString':
      return linesPlace([geometry.coordinates]);
    case 'MultiLineString':
    case 'Polygon':
      return linesPlace(geometry.coordinates);
    case 'MultiPolygon':
      return linesPlace(geometry.coordinates.flat());
  }
}

/** The mark of a line sits on its middle vertex, so it lies on the street it covers. */
function linesPlace(lines: readonly (readonly LonLat[])[]): Pick<CityItem, 'point' | 'lines'> {
  const drawn = lines.filter((line) => line.length >= 2).map((line) => line.map(copy));
  const first = drawn[0] ?? lines[0]?.map(copy) ?? [];
  const middle = first[Math.floor(first.length / 2)];
  return { point: middle ?? null, lines: drawn };
}

const copy = ([lon, lat]: LonLat): [number, number] => [lon, lat];

/** A source's `[lon, lat]` point as an item's place. */
export const pointPlace = ([lon, lat]: LonLat): Pick<CityItem, 'point' | 'lines'> => ({
  point: [lon, lat],
  lines: [],
});

/** No place: the source names it in words only, so it is listed and never drawn. */
export const NO_PLACE: Pick<CityItem, 'point' | 'lines'> = { point: null, lines: [] };

const inside = (box: BoundingBox, [lon, lat]: LonLat) =>
  lon >= box[0] && lat >= box[1] && lon <= box[2] && lat <= box[3];

/**
 * An item is in the box when its mark or any vertex of its lines is; an item with no place is in
 * every box, as the lists of the panel are of the whole city.
 */
export function inBox(item: CityItem, box: BoundingBox | undefined): boolean {
  if (box === undefined || item.point === null) return true;
  return inside(box, item.point) || item.lines.some((line) => line.some((at) => inside(box, at)));
}
