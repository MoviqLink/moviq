/** The choices of time on the layer: the rest of today, tonight, or this weekend. */
export const EVENT_RANGES = ['today', 'tonight', 'weekend'] as const;

export type EventRange = (typeof EVENT_RANGES)[number];

/**
 * A New York day runs from 05:00 to 05:00, as the night out does: at 01:00 it is still last
 * night. Tonight starts at 17:00; the weekend runs from Friday 17:00 to Monday 05:00.
 */
const DAY_STARTS = 5;
const NIGHT_STARTS = 17;

const wallFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Wall {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
}

function wallOf(instant: Date): Wall & { readonly minute: number; readonly second: number } {
  const parts = new Map(wallFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.get(type));
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** The instant of a New York date at a whole hour; two passes settle daylight saving. */
function instantAt(year: number, month: number, day: number, hour: number): Date {
  const target = Date.UTC(year, month - 1, day, hour);
  let guess = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const wall = wallOf(new Date(guess));
    const shown = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    guess = target - (shown - guess);
  }
  return new Date(guess);
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/** The window of a choice at `now`: never earlier than now, always whole New York hours. */
export function rangeWindow(range: EventRange, now: Date): TimeWindow {
  const wall = wallOf(now);
  // The calendar date of the city day holding now, as a UTC midnight to count days on.
  const date = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day - (wall.hour < DAY_STARTS ? 1 : 0)),
  );
  const at = (days: number, hour: number) =>
    instantAt(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() + days, hour);
  const later = (instant: Date) => (instant > now ? instant : now);
  switch (range) {
    case 'today':
      return { from: now, to: at(1, DAY_STARTS) };
    case 'tonight':
      return { from: later(at(0, NIGHT_STARTS)), to: at(1, DAY_STARTS) };
    case 'weekend': {
      // Sunday is 0: Friday is this week's from Monday to Thursday, and the one just gone after.
      const weekday = date.getUTCDay();
      const toFriday = weekday === 6 ? -1 : weekday === 0 ? -2 : 5 - weekday;
      return { from: later(at(toFriday, NIGHT_STARTS)), to: at(toFriday + 3, DAY_STARTS) };
    }
  }
}
