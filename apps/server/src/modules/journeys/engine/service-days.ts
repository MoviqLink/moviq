import { fromNewYorkWallClock, newYorkGtfsDate } from '../../../infrastructure/clock/new-york.js';
import {
  serviceRunsOn,
  type GtfsService,
} from '../../data-platform/sources/mta/gtfs-static-schema.js';

const HOUR_MS = 3_600_000;

/** A service day the search uses, measured in seconds from the search epoch. */
interface ServiceDay {
  readonly date: string;
  /** Seconds from the epoch to this day's start, so a trip time plus it is a search time. */
  readonly offset: number;
  /** 1 for each network service running on this date, by `calendar` and `calendar_dates`. */
  readonly running: Uint8Array;
}

export interface SearchCalendar {
  /** The start of the earliest service day, in Unix milliseconds. */
  readonly epochMs: number;
  readonly days: readonly ServiceDay[];
}

/**
 * The start of a GTFS service day: noon in New York minus 12 hours, as the GTFS reference defines
 * it, so trip times stay right on the days daylight saving changes.
 */
function serviceDayStart(date: string): number | undefined {
  const noon = fromNewYorkWallClock({
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(4, 6)),
    day: Number(date.slice(6, 8)),
    hour: 12,
    minute: 0,
    second: 0,
  });
  return noon === undefined ? undefined : noon.getTime() - 12 * HOUR_MS;
}

function previousGtfsDate(date: string): string {
  const day = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) - 1),
  );
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * The service days that can carry a trip ending by `deadline`: the New York date of the deadline
 * and the one before, whose trips run past midnight with times after 24:00.
 */
export function searchCalendar(
  services: readonly GtfsService[],
  deadline: Date,
): SearchCalendar | undefined {
  const today = newYorkGtfsDate(deadline);
  const dates = [previousGtfsDate(today), today];
  const starts = dates.map(serviceDayStart);
  const epochMs = starts[0];
  if (epochMs === undefined || starts.some((start) => start === undefined)) return undefined;
  const days = dates.map((date, index) => ({
    date,
    offset: Math.round(((starts[index] ?? epochMs) - epochMs) / 1000),
    running: Uint8Array.from(services, (service) => (serviceRunsOn(service, date) ? 1 : 0)),
  }));
  return { epochMs, days };
}
