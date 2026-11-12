import {
  fromNewYorkWallClock,
  toNewYorkWallClockText,
  weekdayOfGtfsDate,
} from '../../../infrastructure/clock/new-york.js';

/** The New York hour after which yesterday is reduced: late trips of the night have ended. */
export const NIGHTLY_HOUR = 4;

/** Bands of the New York day in which service behaves alike. */
export type Band = 'night' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';
/** Without a holiday calendar a holiday counts as the weekday it falls on. */
export type DayType = 'weekday' | 'saturday' | 'sunday';

const BANDS: readonly { readonly from: number; readonly band: Band }[] = [
  { from: 20, band: 'evening' },
  { from: 16, band: 'pm-peak' },
  { from: 10, band: 'midday' },
  { from: 6, band: 'am-peak' },
  { from: 0, band: 'night' },
];

const HOUR_MS = 3_600_000;
/** Bands by UTC hour: New York is a whole number of hours from UTC, so one hour has one band. */
const bandsByHour = new Map<number, Band>();

/**
 * The band of an instant: night 0–6, AM peak 6–10, midday 10–16, PM peak 16–20, evening 20–24.
 * Each UTC hour is converted once: a day of segments asks for it a hundred thousand times, and
 * converting to New York time is slow.
 */
export function bandOf(instant: Date): Band {
  const index = Math.floor(instant.getTime() / HOUR_MS);
  const known = bandsByHour.get(index);
  if (known !== undefined) return known;
  const hour = Number(toNewYorkWallClockText(new Date(index * HOUR_MS)).slice(11, 13));
  const band = BANDS.find((entry) => hour >= entry.from)?.band ?? 'night';
  if (bandsByHour.size > 10_000) bandsByHour.clear();
  bandsByHour.set(index, band);
  return band;
}

/** The New York day (`YYYY-MM-DD`) of an instant. */
export function dayOf(instant: Date): string {
  return toNewYorkWallClockText(instant).slice(0, 10);
}

export function dayTypeOf(day: string): DayType {
  const weekday = weekdayOfGtfsDate(day.replaceAll('-', ''));
  if (weekday === 5) return 'saturday';
  if (weekday === 6) return 'sunday';
  return 'weekday';
}

/** The calendar day `offset` days from `day`. */
export function shiftDay(day: string, offset: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

/** The first instant of a New York day. */
export function startOfDay(day: string): Date {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const start = fromNewYorkWallClock({ year, month, day: date, hour: 0, minute: 0, second: 0 });
  if (start === undefined) throw new RangeError(`Not a day: ${day}`);
  return start;
}

/**
 * The hours (`HH`) a New York day has, each with its first instant: 23 in spring, and 24 in
 * autumn, where the repeated hour is one.
 */
export function hoursOfDay(day: string): { readonly hour: string; readonly at: Date }[] {
  const start = startOfDay(day).getTime();
  const end = startOfDay(shiftDay(day, 1)).getTime();
  const hours = new Map<string, Date>();
  for (let at = start; at < end; at += 3_600_000) {
    const hour = toNewYorkWallClockText(new Date(at)).slice(11, 13);
    if (!hours.has(hour)) hours.set(hour, new Date(at));
  }
  return [...hours].map(([hour, at]) => ({ hour, at }));
}
