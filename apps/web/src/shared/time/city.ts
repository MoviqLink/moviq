/** Every trip happens in New York, so its times are written in New York time wherever the reader is. */
const CITY_TIME_ZONE = 'America/New_York';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions, key: string) {
  const id = `${locale}|${key}`;
  let found = formatters.get(id);
  if (found === undefined) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone: CITY_TIME_ZONE });
    formatters.set(id, found);
  }
  return found;
}

/** The time of day in New York: `7:52 PM` in English, `19:52` in Spanish. */
export function formatCityTime(instant: string, locale: string): string {
  return formatter(locale, { hour: 'numeric', minute: '2-digit' }, 'time').format(
    new Date(instant),
  );
}

/** The day in New York, short: `Wed, Nov 11` or `mié, 11 nov`. */
export function formatCityDay(instant: string, locale: string): string {
  return formatter(locale, { weekday: 'short', day: 'numeric', month: 'short' }, 'day').format(
    new Date(instant),
  );
}

/** Whole minutes from one instant to another, rounded down so a margin is never overstated. */
export function minutesBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
}

/** The time of day in New York split from its period, so `PM` can be set smaller than `7:52`. */
export function cityTimeParts(
  instant: string,
  locale: string,
): { time: string; period: string | null } {
  const parts = formatter(locale, { hour: 'numeric', minute: '2-digit' }, 'time').formatToParts(
    new Date(instant),
  );
  const period = parts.find((part) => part.type === 'dayPeriod')?.value ?? null;
  const time = parts
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
  return { time, period };
}
