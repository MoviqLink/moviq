import { z } from 'zod';

/** An instant in UTC, written as ISO 8601 with a trailing `Z` (for example `2026-11-11T09:30:00.000Z`). */
export const instantSchema = z.iso.datetime();

export type Instant = z.infer<typeof instantSchema>;

/** The only way MovIQ turns a `Date` into an instant, so every stored and served time looks the same. */
export function toInstant(date: Date): Instant {
  return date.toISOString();
}
