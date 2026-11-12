export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/**
 * How far a capture moves so that the moment it was taken falls on the anchor, the test's "now".
 * Whole minutes, rounded down, so shifted data is never newer than the anchor and the times
 * people type ("by 10:55 pm") stay whole minutes too.
 */
export function shiftFor(anchorMs: number, capturedAtMs: number): number {
  return Math.floor((anchorMs - capturedAtMs) / MINUTE) * MINUTE;
}

/** An ISO 8601 date-time in UTC, as Transitous writes them. */
const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The same instant written again after moving it, with or without milliseconds as before. */
function shiftIsoText(text: string, shiftMs: number): string {
  const moved = new Date(Date.parse(text) + shiftMs).toISOString();
  return text.includes('.') ? moved : moved.replace(/\.\d{3}Z$/, 'Z');
}

export function isUtcDateTime(text: string): boolean {
  return UTC_DATE_TIME.test(text);
}

/** Every UTC date-time string anywhere in a JSON value, moved by the same amount. */
export function shiftJsonTimes(value: unknown, shiftMs: number): unknown {
  if (typeof value === 'string') return isUtcDateTime(value) ? shiftIsoText(value, shiftMs) : value;
  if (Array.isArray(value)) return value.map((item: unknown) => shiftJsonTimes(item, shiftMs));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, shiftJsonTimes(item, shiftMs)]),
    );
  }
  return value;
}
