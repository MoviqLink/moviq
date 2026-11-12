import { corrected, filterFor, MAX_GAP_MS, startFilter } from '../../live/estimation/gps-plus.js';
import { predict, type AlongLine } from '../../live/estimation/kalman.js';
import { bearingDegrees, distanceMeters } from '../../live/geo.js';
import type { BusReport } from './bus-reports.js';
import { bandOf } from './calendar.js';
import { stretchBetween, stretchOf, type TypicalSpeeds } from './stretch-speeds.js';
import type { Counts } from './statistics.js';

/** Upper bounds, in seconds since the last report, of the bands the error is kept by. */
export const AGE_BANDS = [15, 30, 45, 60, 90, 120, 180, 240, MAX_GAP_MS / 1000] as const;
/** Errors are counted in steps of 5 m, rounded up: a margin is never smaller than measured. */
const ERROR_STEP = 5;
/** The reports before one that it judges: enough for five minutes of reports every 30 s. */
const LOOK_BACK = 10;

const BUS = filterFor('bus');

/** The band of an age, or undefined beyond the last one (the estimator starts again then). */
export function ageBand(seconds: number): number | undefined {
  if (!(seconds > 0)) return undefined;
  const index = AGE_BANDS.findIndex((upper) => seconds < upper);
  if (index !== -1) return index;
  return seconds === AGE_BANDS.at(-1) ? AGE_BANDS.length - 1 : undefined;
}

export interface TrackingErrorRow {
  readonly mode: 'bus';
  readonly route: string;
  readonly ageFrom: number;
  readonly ageTo: number;
  readonly n: number;
  /** `[metres, how many]`, sorted. */
  readonly counts: Counts;
}

/** What the estimator kept after one report. */
interface Kept {
  readonly report: BusReport;
  readonly filter: AlongLine;
  /**
   * The typical speed of the stretch it went on; undefined until the heading of the bus is known
   * (the estimator reads it from the shape at once; here it is the heading of the next move).
   */
  readonly typical: number | null | undefined;
  /** What was drawn when the report came: the estimator never draws behind it. */
  readonly floor: number;
}

interface Followed {
  readonly meters: number;
  readonly heading: number | null;
  readonly kept: readonly Kept[];
}

/**
 * The error of the `gps-plus` positions of buses, replayed: the estimator's bus filter follows
 * each trip along the path of its reports (metres added report by report), with the typical
 * speed of each stretch given, and every report judges where each of the ten before it would
 * have drawn the bus at its moment against where it reported, by route and age. The estimator's
 * rules are its own (`gps-plus.ts`): a jump of 500 m or a gap of five minutes starts it again, a
 * bus within 8 m stands, nothing is drawn behind what was. Its shapes are not read: a bus runs on
 * its shape (14 of 14 within 0.6 m, 11/11/2026), so the error along the path is its error.
 */
// eslint-disable-next-line max-lines-per-function -- one closure keeps every vehicle of the day
export function createTrackingErrors(typical: TypicalSpeeds) {
  const vehicles = new Map<string, Followed>();
  const groups = new Map<string, { route: string; band: number; counts: Map<number, number> }>();

  const count = (route: string, age: number, error: number) => {
    const band = ageBand(age);
    if (band === undefined) return;
    const key = `${route}\u0000${String(band)}`;
    const group = groups.get(key) ?? { route, band, counts: new Map<number, number>() };
    const value = Math.ceil(error / ERROR_STEP) * ERROR_STEP;
    group.counts.set(value, (group.counts.get(value) ?? 0) + 1);
    groups.set(key, group);
  };

  const typicalAt = (report: BusReport, heading: number | null) =>
    heading === null
      ? undefined
      : typical(report.route, stretchOf(report.point, heading), bandOf(new Date(report.at * 1000)));

  /** Where the estimator would draw the bus `at`, from what it kept after one report. */
  const drawnAt = (kept: Kept, at: number) =>
    Math.max(
      kept.floor,
      predict(kept.filter, at - kept.report.at, BUS, kept.typical ?? null).meters,
    );

  function follow(state: Followed, report: BusReport, previous: BusReport): Followed {
    const moved = distanceMeters(previous.point, report.point);
    const meters = state.meters + moved;
    const heading =
      stretchBetween(previous.point, report.point) === undefined
        ? state.heading
        : bearingDegrees(previous.point, report.point);
    const kept = state.kept.map((entry) =>
      entry.typical === undefined ? { ...entry, typical: typicalAt(entry.report, heading) } : entry,
    );
    let drawn = meters;
    for (const entry of kept) {
      drawn = drawnAt(entry, report.at);
      count(report.route, report.at - entry.report.at, Math.abs(drawn - meters));
    }
    const last = kept.at(-1);
    const expected =
      last === undefined
        ? undefined
        : predict(last.filter, report.at - last.report.at, BUS, last.typical ?? null);
    const filter = expected === undefined ? undefined : corrected(expected, meters, moved, BUS);
    const here = { report, typical: typicalAt(report, heading) };
    if (filter === undefined)
      return {
        meters,
        heading,
        kept: [{ ...here, filter: startFilter(meters, BUS), floor: meters }],
      };
    return {
      meters,
      heading,
      kept: [...kept, { ...here, filter, floor: drawn }].slice(-LOOK_BACK),
    };
  }

  return {
    add(vehicle: string, report: BusReport, previous: BusReport | undefined): void {
      const state = previous === undefined ? undefined : vehicles.get(vehicle);
      const start: Followed = {
        meters: 0,
        heading: null,
        kept: [{ report, filter: startFilter(0, BUS), typical: undefined, floor: 0 }],
      };
      vehicles.set(
        vehicle,
        state === undefined || previous === undefined ? start : follow(state, report, previous),
      );
    },

    rows(): TrackingErrorRow[] {
      return [...groups.values()].map(({ route, band, counts }) => {
        const sorted: Counts = [...counts].sort(([a], [b]) => a - b);
        return {
          mode: 'bus',
          route,
          ageFrom: band === 0 ? 0 : (AGE_BANDS[band - 1] ?? 0),
          ageTo: AGE_BANDS[band] ?? 0,
          n: sorted.reduce((total, [, n]) => total + n, 0),
          counts: sorted,
        };
      });
    },
  };
}
