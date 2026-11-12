/**
 * New York time, the one place that turns instants into New York dates and wall-clock times and
 * back. Providers publish local times without zone (Socrata), GTFS service dates (`YYYYMMDD`)
 * and wall-clock fields; daylight saving is handled here and nowhere else.
 */
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const WALL_CLOCK_TEXT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?$/;

function wallClockOf(instant: Date): WallClock {
  const parts = new Map(partsFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type));
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function asUtcMs(clock: WallClock): number {
  return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/**
 * The instant of a New York wall-clock time, or undefined when the fields do not form a real date.
 * Two passes settle the offset on either side of a daylight-saving change.
 */
export function fromNewYorkWallClock(clock: WallClock): Date | undefined {
  const target = asUtcMs(clock);
  const check = new Date(target);
  const real =
    check.getUTCFullYear() === clock.year &&
    check.getUTCMonth() === clock.month - 1 &&
    check.getUTCDate() === clock.day &&
    clock.hour < 24 &&
    clock.minute < 60 &&
    clock.second < 60;
  if (!real) return undefined;
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = target - (asUtcMs(wallClockOf(new Date(guess))) - guess);
  }
  return new Date(guess);
}

/** `YYYY-MM-DDTHH:mm:ss` in New York, the form of zone-less timestamps such as Socrata's. */
export function toNewYorkWallClockText(instant: Date): string {
  const clock = wallClockOf(instant);
  const date = `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}`;
  return `${date}T${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`;
}

/**
 * The instant of a zone-less New York time (`2026-11-10T18:07:07.000`), or undefined when the
 * text is not one or names a time that does not exist (the hour skipped in spring).
 */
export function fromNewYorkWallClockText(text: string): Date | undefined {
  const match = WALL_CLOCK_TEXT.exec(text);
  if (match === null) return undefined;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match
    .slice(1, 7)
    .map(Number);
  const instant = fromNewYorkWallClock({ year, month, day, hour, minute, second });
  return instant !== undefined && toNewYorkWallClockText(instant) === text.slice(0, 19)
    ? instant
    : undefined;
}

/** A GTFS service date (`YYYYMMDD`) at midnight in New York, or undefined when not a real date. */
export function fromGtfsDate(date: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  if (!match) return undefined;
  return fromNewYorkWallClock({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

/** The New York calendar date of an instant as a GTFS service date (`YYYYMMDD`). */
export function newYorkGtfsDate(instant: Date): string {
  const clock = wallClockOf(instant);
  return `${pad(clock.year, 4)}${pad(clock.month)}${pad(clock.day)}`;
}

/** Monday is 0 and Sunday 6, as the columns of GTFS `calendar.txt`. */
export function weekdayOfGtfsDate(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}
