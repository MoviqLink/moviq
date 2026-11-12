import { bearingDegrees, distanceMeters, type Point } from '../../live/geo.js';
import type { BusReport } from './bus-reports.js';
import { bandOf, type Band, type DayType } from './calendar.js';
import { quantileOfCounts, type Counts } from './statistics.js';

/**
 * A stretch is a square of street `STRETCH_METERS` on a side, crossed in one of four headings
 * (centred on north, east, south and west, so the grids of New York, true or at Manhattan's 29°,
 * fall inside one): the same place in both directions is two stretches. It is found from a
 * point alone, so both recorders measure it without the timetables, which the Cloudflare one
 * cannot hold, and the estimator finds it from the point of its shape it asks about.
 */
const STRETCH_METERS = 250;
const METERS_PER_DEGREE = 111_195;
/** One plane for the whole city, tangent at New York's latitude: cells keep their place. */
const EAST_METERS_PER_DEGREE = METERS_PER_DEGREE * Math.cos((40.7 * Math.PI) / 180);
/** Under this, two reports are the GPS of a bus standing (the recorder's own threshold). */
const MOVED_METERS = 15;
/** Faster than the bus filter allows (90 km/h) is a GPS error, not a speed. */
const MAX_SPEED = 25;
/** Speeds are counted in steps of half a metre a second. */
const SPEED_STEP = 0.5;

/** The stretch around `point`, crossed at `heading` degrees from north. */
export function stretchOf(point: Point, heading: number): string {
  const x = Math.floor((point.lon * EAST_METERS_PER_DEGREE) / STRETCH_METERS);
  const y = Math.floor((point.lat * METERS_PER_DEGREE) / STRETCH_METERS);
  const quarter = Math.floor((((heading % 360) + 360 + 45) % 360) / 90);
  return `${String(x)}:${String(y)}:${String(quarter)}`;
}

/** The stretch a bus crossed from one report to the next, or undefined when it stood still. */
export function stretchBetween(from: Point, to: Point): string | undefined {
  if (distanceMeters(from, to) < MOVED_METERS) return undefined;
  const middle = { lat: (from.lat + to.lat) / 2, lon: (from.lon + to.lon) / 2 };
  return stretchOf(middle, bearingDegrees(from, to));
}

export interface StretchSpeedRow {
  readonly mode: 'bus';
  readonly route: string;
  readonly stretch: string;
  readonly band: Band;
  readonly dayType: DayType;
  readonly n: number;
  /** `[metres a second, how many]`, sorted. */
  readonly counts: Counts;
}

const keyOf = (route: string, stretch: string, band: Band) =>
  `${route}\u0000${stretch}\u0000${band}`;

/** Fewer moves than this give no typical speed, as every figure of the recorder. */
const MIN_MOVES = 20;

interface Group {
  readonly route: string;
  readonly stretch: string;
  readonly band: Band;
  readonly counts: Map<number, number>;
  n: number;
  /** The median, once asked for: the first reading has ended by then. */
  median?: number;
}

function rowOf(group: Group, dayType: DayType): StretchSpeedRow {
  const counts: Counts = [...group.counts].sort(([a], [b]) => a - b);
  const { route, stretch, band, n } = group;
  return { mode: 'bus', route, stretch, band, dayType, n, counts };
}

/**
 * The speed of buses by route, stretch, band and kind of day: from each report to the next one
 * of the same trip in which the bus moved, its straight distance over the seconds between them,
 * counted at the stretch of the middle of the move and the band of its start.
 */
export function createStretchSpeeds(dayType: DayType) {
  const groups = new Map<string, Group>();
  return {
    add(_vehicle: string, report: BusReport, previous: BusReport | undefined): void {
      if (previous === undefined) return;
      const stretch = stretchBetween(previous.point, report.point);
      if (stretch === undefined) return;
      const speed = distanceMeters(previous.point, report.point) / (report.at - previous.at);
      if (!(speed <= MAX_SPEED)) return;
      const band = bandOf(new Date(previous.at * 1000));
      const key = keyOf(report.route, stretch, band);
      let group = groups.get(key);
      if (group === undefined) {
        group = { route: report.route, stretch, band, counts: new Map(), n: 0 };
        groups.set(key, group);
      }
      const value = Math.round(speed / SPEED_STEP) * SPEED_STEP;
      group.counts.set(value, (group.counts.get(value) ?? 0) + 1);
      group.n += 1;
    },

    /** The median speed of a stretch measured 20 times or more, for the estimator replayed. */
    typical(route: string, stretch: string, band: Band): number | null {
      const group = groups.get(keyOf(route, stretch, band));
      if (group === undefined || group.n < MIN_MOVES) return null;
      group.median ??= quantileOfCounts(rowOf(group, dayType).counts, 0.5);
      return group.median;
    },

    /** Every stretch measured, `size` at a time, so a day of the city is turned into rows in steps. */
    *batches(size: number): Generator<StretchSpeedRow[]> {
      let batch: StretchSpeedRow[] = [];
      for (const group of groups.values()) {
        batch.push(rowOf(group, dayType));
        if (batch.length >= size) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length > 0) yield batch;
    },
  };
}

export type TypicalSpeeds = (route: string, stretch: string, band: Band) => number | null;
