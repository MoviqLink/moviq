/**
 * How the vehicle card writes its numbers, as Vektia's card does: signal bars from the age of the
 * last report, margins rounded to what was measured, speeds, courses and delays in plain words.
 */

/** 4 bars under 30 s, 3 under a minute, 2 under two minutes, 1 beyond. */
export function signalBars(ageSeconds: number): 1 | 2 | 3 | 4 {
  if (ageSeconds < 30) return 4;
  if (ageSeconds < 60) return 3;
  if (ageSeconds < 120) return 2;
  return 1;
}

/** `± 80 m`, `± 1,2 km`: never more precise than the measure (10 m steps under 100 m, then 50). */
export function formatMargin(meters: number, locale: string): string {
  if (meters >= 1000) {
    const km = Math.round(meters / 100) / 10;
    return `± ${km.toLocaleString(locale)} km`;
  }
  const step = meters < 100 ? 10 : 50;
  return `± ${String(Math.max(step, Math.round(meters / step) * step))} m`;
}

/** Whole km/h, or null for a vehicle standing still (under 1 km/h). */
export function roundSpeed(kmh: number): number | null {
  const rounded = Math.round(kmh);
  return rounded < 1 ? null : rounded;
}

/** A course in whole degrees, in [0, 360). */
export function wholeDegrees(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** The index of the nearest of the 16 compass points, north first. */
export function compassPoint(degrees: number): number {
  return Math.round(wholeDegrees(degrees) / 22.5) % 16;
}

/** A rounded, normalized course in degrees. */
export const courseText = (degrees: number): string => `${String(wholeDegrees(degrees))}°`;

export type Punctuality =
  { readonly kind: 'on-time' } | { readonly kind: 'late' | 'early'; readonly minutes: number };

/** Within two minutes either way a vehicle is on time; beyond, late or early by whole minutes. */
export function punctuality(delaySeconds: number): Punctuality {
  const minutes = Math.round(delaySeconds / 60);
  if (Math.abs(minutes) <= 2) return { kind: 'on-time' };
  return minutes > 0 ? { kind: 'late', minutes } : { kind: 'early', minutes: -minutes };
}

/** `18 s`, `4 min`, `1 h 5 min`: how long ago, in the units a reader expects. */
export function ageText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${String(whole)} s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const rest = minutes % 60;
  return `${String(Math.floor(minutes / 60))} h${rest === 0 ? '' : ` ${String(rest)} min`}`;
}

// Street words the MTA writes in capitals that read as words, not as initials.
const STREET_WORDS = new Set([
  'ST',
  'AV',
  'AVE',
  'BLVD',
  'PKWY',
  'RD',
  'DR',
  'PL',
  'CT',
  'LN',
  'HWY',
  'TPKE',
  'SQ',
  'PLZ',
  'BWAY',
  'EXPY',
  'EXPWY',
]);

function titleWord(word: string): string {
  if (!/[A-Z]/.test(word)) return word;
  if (!/[AEIOUY]/.test(word) && !STREET_WORDS.has(word)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * Bus stops come in capitals (`MERRICK BLVD/MONTAUK ST`); they are written in title case, and
 * initials such as `JFK` keep their capitals. A name already in mixed case is left as it is.
 */
export function stopName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.replace(/[A-Z]+/g, titleWord);
}
