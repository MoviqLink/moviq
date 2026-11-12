import type { VehicleMode } from '@moviq/contracts';

import { distanceMeters, type Point } from '../geo.js';
import { correct, predict, startAt, type AlongLine, type FilterParameters } from './kalman.js';
import { place, type Line, type Placement } from './line.js';

/**
 * The bus filter of Vektia (`web/assets/fisica.js`, `gps.BUS`), tuned on its bench of 07/11/2026
 * with Barcelona buses reporting every 30 s, as Bus Time does: q 0.3 m²/s³, r 10 m, at most
 * 25 m/s (90 km/h), and a speed that settles in about 40 s.
 */
const BUS_FILTER: FilterParameters = { q: 0.3, r: 10, maxSpeed: 25, settleSeconds: 40 };
/**
 * The train filter of Vektia (`web/assets/fisica.js`, `gps.params`), tuned on its Rodalies bench:
 * q 0.03 m²/s³, r 30 m and at most 140 km/h. The 40 s settle is the buses': it applies only once
 * the recorder gives the typical speed of a stretch.
 */
const RAIL_FILTER: FilterParameters = { q: 0.03, r: 30, maxSpeed: 140 / 3.6, settleSeconds: 40 };

/**
 * Trains run with the train filter; every other mode with the bus filter, the only one measured
 * on road and water speeds alike (boats are not benched yet, and none is faster than 25 m/s).
 */
export const filterFor = (mode: VehicleMode): FilterParameters =>
  mode === 'rail' ? RAIL_FILTER : BUS_FILTER;
/** The speed of a first report is unknown: 10 m/s of spread covers a bus standing or at 70 km/h. */
const FIRST_SPEED_SD = 10;

/** A report this far from where the filter expected it is a jump it cannot follow. */
const JUMP_METERS = 500;
/** A report this far from the line of its trip is not on that line. */
export const OFF_LINE_METERS = 100;
/** Two reports this close are the vehicle standing (Vektia's `quieto`, 8 m for buses). */
const STILL_METERS = 8;
/** Reports further apart than this (the staleness of Bus Time positions) are not one motion. */
export const MAX_GAP_MS = 5 * 60_000;

/** One vehicle followed along its line between GPS reports. */
export interface GpsTrack {
  readonly line: string;
  readonly route: string;
  readonly direction: 0 | 1 | null;
  readonly filter: AlongLine;
  /** The report the filter rests on, placed on the line. */
  readonly report: Point & Placement & { readonly at: number };
  /** The furthest metres drawn since the filter last started: nothing is drawn behind it. */
  readonly drawn: number;
}

/** A GPS report of a vehicle on the line of its trip. */
interface GpsReport {
  readonly route: string;
  readonly direction: 0 | 1 | null;
  readonly line: Line;
  readonly point: Point;
  /** Milliseconds since the epoch. */
  readonly at: number;
}

/** Why the filter started again on a report instead of correcting itself with it. */
type Restart = 'first' | 'other-line' | 'gap' | 'jump';

/** The next stop ahead and when the operator expects the vehicle to leave it. */
export interface StopAhead {
  readonly meters: number;
  readonly leavesAt: number;
}

/** The filter on a first report, `meters` along the line, with its speed not yet known. */
export const startFilter = (meters: number, parameters: FilterParameters): AlongLine =>
  startAt(meters, parameters, FIRST_SPEED_SD);

function started(report: GpsReport, placement: Placement, filter: FilterParameters): GpsTrack {
  return {
    line: report.line.id,
    route: report.route,
    direction: report.direction,
    filter: startFilter(placement.meters, filter),
    report: { ...report.point, ...placement, at: report.at },
    drawn: placement.meters,
  };
}

/** A start on a report placed anywhere on its line, or undefined when it is off the line. */
function restartOn(report: GpsReport, why: Restart, filter: FilterParameters) {
  const placement = place(report.line, report.point);
  if (placement.offsetMeters > OFF_LINE_METERS) return undefined;
  return { track: started(report, placement, filter), restart: why };
}

/**
 * Follows a new report. One that continues the track corrects the filter; one on another line,
 * route or direction, after a gap, or more than `JUMP_METERS` from where it was expected starts
 * the filter again on it. Undefined when the report is off the line of its trip.
 */
export function follow(
  track: GpsTrack | undefined,
  report: GpsReport,
  typicalSpeed: number | null,
  parameters: FilterParameters,
): { readonly track: GpsTrack; readonly restart: Restart | null } | undefined {
  if (track === undefined) return restartOn(report, 'first', parameters);
  if (report.at <= track.report.at) return { track, restart: null };
  const sameLine =
    track.line === report.line.id &&
    track.route === report.route &&
    track.direction === report.direction;
  if (!sameLine) return restartOn(report, 'other-line', parameters);
  if (report.at - track.report.at > MAX_GAP_MS) return restartOn(report, 'gap', parameters);
  const seconds = (report.at - track.report.at) / 1000;
  const expected = predict(track.filter, seconds, parameters, typicalSpeed);
  const near = place(
    report.line,
    report.point,
    expected.meters - JUMP_METERS,
    expected.meters + JUMP_METERS,
  );
  const moved = distanceMeters(track.report, report.point);
  const filter =
    near.offsetMeters > OFF_LINE_METERS
      ? undefined
      : corrected(expected, near.meters, moved, parameters);
  if (filter === undefined) return restartOn(report, 'jump', parameters);
  return {
    track: { ...track, filter, report: { ...report.point, ...near, at: report.at } },
    restart: null,
  };
}

/**
 * The filter expected at a report, corrected by it: `measured` metres along the line, `moved`
 * metres from the report before. Undefined when the report lies `JUMP_METERS` or more from where
 * it was expected (placed at the edge of its window, it lies beyond it), a jump the filter does
 * not follow. A vehicle that has not moved is standing: correcting its speed would drag it back.
 */
export function corrected(
  expected: AlongLine,
  measured: number,
  moved: number,
  parameters: FilterParameters,
): AlongLine | undefined {
  if (Math.abs(measured - expected.meters) >= JUMP_METERS) return undefined;
  const filter = correct(expected, measured, parameters);
  return moved <= STILL_METERS ? { ...filter, speed: 0, dv: 0, vv: 0.25 } : filter;
}

/**
 * The metres along the line at `now`: the filter carried forward from its last report, held at
 * the next stop until the operator expects the vehicle to leave it, never past the end of the
 * line and never behind what was drawn before.
 */
export function metersAt(
  track: GpsTrack,
  line: Line,
  now: number,
  typicalSpeed: number | null,
  next: StopAhead | undefined,
  filter: FilterParameters,
): { readonly meters: number; readonly track: GpsTrack } {
  const seconds = Math.max(0, (now - track.report.at) / 1000);
  const ahead = predict(track.filter, seconds, filter, typicalSpeed);
  let meters = ahead.meters;
  if (next !== undefined && next.meters > track.filter.meters && meters > next.meters) {
    const sinceLeaving = Math.max(0, (now - next.leavesAt) / 1000);
    meters = Math.min(meters, next.meters + ahead.speed * sinceLeaving);
  }
  const drawn = Math.max(track.drawn, Math.min(line.length, Math.max(0, meters)));
  return { meters: drawn, track: { ...track, drawn } };
}
