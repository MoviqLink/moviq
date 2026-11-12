/** Seconds from an instant to `nowMs`, never negative, so a browser clock a little behind reads 0. */
export function secondsSince(instant: string, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(instant)) / 1000);
}

/** Seconds from `nowMs` to an instant; negative once it has passed. */
export function secondsUntil(instant: string, nowMs: number): number {
  return (Date.parse(instant) - nowMs) / 1000;
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

/** The browser's local time with seconds, with the date in front when it is not today. */
export function formatClock(instant: string, locale: string, nowMs: number): string {
  const date = new Date(instant);
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  if (sameDay(date, new Date(nowMs))) return time;
  const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}
