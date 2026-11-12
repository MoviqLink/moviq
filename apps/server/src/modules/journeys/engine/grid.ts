import { distanceMetres } from './walking.js';

/** The area MovIQ plans in, the bounds of a `Place` in the contracts. */
const AREA = { south: 40.4, north: 41.1, west: -74.4, east: -73.6 } as const;

/** About 280 m a side in New York: 0.0025° of latitude, 0.0033° of longitude at 40.7° N. */
const CELL_LAT = 0.0025;
const CELL_LON = 0.0033;
const ROWS = Math.ceil((AREA.north - AREA.south) / CELL_LAT);
const COLUMNS = Math.ceil((AREA.east - AREA.west) / CELL_LON);

export function insideArea(lat: number, lon: number): boolean {
  return lat >= AREA.south && lat <= AREA.north && lon >= AREA.west && lon <= AREA.east;
}

function rowOf(lat: number): number {
  return Math.min(ROWS - 1, Math.max(0, Math.floor((lat - AREA.south) / CELL_LAT)));
}

function columnOf(lon: number): number {
  return Math.min(COLUMNS - 1, Math.max(0, Math.floor((lon - AREA.west) / CELL_LON)));
}

/** Stops bucketed by cell in two flat arrays: cell `c` holds `stops[start[c]..start[c + 1]]`. */
export interface StopGrid {
  readonly start: Int32Array;
  readonly stops: Int32Array;
}

export function buildGrid(lat: Float64Array, lon: Float64Array): StopGrid {
  const cells = ROWS * COLUMNS;
  const cellOf = new Int32Array(lat.length);
  const start = new Int32Array(cells + 1);
  for (let stop = 0; stop < lat.length; stop += 1) {
    const cell = rowOf(lat[stop] ?? 0) * COLUMNS + columnOf(lon[stop] ?? 0);
    cellOf[stop] = cell;
    start[cell + 1] = (start[cell + 1] ?? 0) + 1;
  }
  for (let cell = 0; cell < cells; cell += 1)
    start[cell + 1] = (start[cell + 1] ?? 0) + (start[cell] ?? 0);
  const fill = start.slice(0, cells);
  const stops = new Int32Array(lat.length);
  for (let stop = 0; stop < lat.length; stop += 1) {
    const cell = cellOf[stop] ?? 0;
    const at = fill[cell] ?? 0;
    stops[at] = stop;
    fill[cell] = at + 1;
  }
  return { start, stops };
}

interface Nearby {
  readonly stop: number;
  readonly metres: number;
}

/** Stops within `radius` metres of a point, in stop order. */
export function nearbyStops(
  grid: StopGrid,
  coordinates: { readonly lat: Float64Array; readonly lon: Float64Array },
  point: { readonly lat: number; readonly lon: number },
  radius: number,
): Nearby[] {
  const latSpan = radius / 111_000;
  const lonSpan = radius / (111_000 * Math.cos((point.lat * Math.PI) / 180));
  const found: Nearby[] = [];
  for (let row = rowOf(point.lat - latSpan); row <= rowOf(point.lat + latSpan); row += 1) {
    for (
      let column = columnOf(point.lon - lonSpan);
      column <= columnOf(point.lon + lonSpan);
      column += 1
    ) {
      const cell = row * COLUMNS + column;
      for (let at = grid.start[cell] ?? 0; at < (grid.start[cell + 1] ?? 0); at += 1) {
        const stop = grid.stops[at] ?? 0;
        const metres = distanceMetres(
          point.lat,
          point.lon,
          coordinates.lat[stop] ?? 0,
          coordinates.lon[stop] ?? 0,
        );
        if (metres <= radius) found.push({ stop, metres });
      }
    }
  }
  return found.sort((a, b) => a.stop - b.stop);
}
