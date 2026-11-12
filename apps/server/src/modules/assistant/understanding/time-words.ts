import {
  fromNewYorkWallClock,
  toNewYorkWallClockText,
} from '../../../infrastructure/clock/new-york.js';
import type { PendingClock } from '../planning/state.js';

/**
 * Times and days as people say them, in English and Spanish, always read as New York time.
 * A time that could be morning or evening ("at 7", "a las 7") is never decided here: it is
 * returned as ambiguous so Sara asks.
 */

/** `am`/`pm` when said, `h24` when written as a 24-hour time, undefined when it could be both. */
type Half = 'am' | 'pm' | 'h24' | undefined;

export interface ClockReading {
  readonly hour: number;
  readonly minute: number;
  readonly half: Half;
  /** The span of the text that said it, marker and context included, so it can be cut out. */
  readonly start: number;
  readonly end: number;
}

interface DayReading {
  /** New York date, `YYYY-MM-DD`. */
  readonly day: string;
  readonly start: number;
  readonly end: number;
}

export type ArrivalReading =
  | { readonly kind: 'at'; readonly at: Date }
  | { readonly kind: 'ambiguous'; readonly pending: PendingClock }
  | { readonly kind: 'passed'; readonly at: Date }
  | { readonly kind: 'too-far' };

const MARKER =
  '(?:at|by|before|around|until|a las|a la|para las|para la|antes de las|sobre las|hacia las|de las|de la)';
const TAGGED = new RegExp(
  `(?:\\b${MARKER}\\s+)?\\b(\\d{1,2})(?:[:.h](\\d{2}))?\\s*(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)(?![a-z])`,
  'i',
);
const WRITTEN = new RegExp(`(?:\\b${MARKER}\\s+)?\\b(\\d{1,2})[:h](\\d{2})\\b`, 'i');
const SPOKEN = new RegExp(
  `\\b${MARKER}\\s+(\\d{1,2})\\b(?![:.]\\d|\\s*(?:st|nd|rd|th|street|calle|av|ave|avenue)\\b)`,
  'i',
);
const NOON = /\b(?:at |by |a las? |al )?(?:noon|midday|mediod[ií]a)\b/i;
const EVENING_AFTER =
  /^\s*(?:de la |por la |in the |at )?(?:tarde|noche|evening|afternoon|night)\b/i;
const MORNING_AFTER = /^\s*(?:de la |por la |in the )?(?:mañana|madrugada|morning)\b/i;
const EVENING_WORDS = [
  'esta tarde',
  'esta noche',
  'tonight',
  'this evening',
  'this afternoon',
  'por la tarde',
  'por la noche',
  'in the evening',
  'in the afternoon',
];
const EVENING_ANYWHERE = new RegExp(`\\b(?:${EVENING_WORDS.join('|')})\\b`, 'i');
const MORNING_ANYWHERE = /\b(?:this morning|in the morning|por la mañana|esta mañana)\b/i;

/** The time of arrival said in the text, if any. */
export function readClock(text: string): ClockReading | undefined {
  const noon = NOON.exec(text);
  if (noon) return { hour: 12, minute: 0, half: 'h24', ...span(noon) };
  const tagged = TAGGED.exec(text);
  if (tagged) {
    const hour = Number(tagged[1]);
    const minute = Number(tagged[2] ?? 0);
    if (hour < 1 || hour > 12 || minute > 59) return undefined;
    const half = (tagged[3] ?? '').toLowerCase().startsWith('p') ? 'pm' : 'am';
    return { hour, minute, half, ...span(tagged) };
  }
  const written = WRITTEN.exec(text);
  const spoken = written ?? SPOKEN.exec(text);
  if (!spoken) return undefined;
  const digits = spoken[1] ?? '';
  const hour = Number(digits);
  const minute = Number(spoken[2] ?? 0);
  if (hour > 23 || minute > 59) return undefined;
  const settled = hour === 0 || hour >= 12 || (written !== null && digits.startsWith('0'));
  if (settled) return { hour, minute, half: 'h24', ...span(spoken) };
  return withContext(text, { hour, minute, ...span(spoken) });
}

/** "7 in the evening", "a las 7 de la tarde": the words around an hour settle its half. */
function withContext(text: string, reading: Omit<ClockReading, 'half'>): ClockReading | undefined {
  const after = text.slice(reading.end);
  const evening = EVENING_AFTER.exec(after);
  if (evening) return { ...reading, half: 'pm', end: reading.end + evening[0].length };
  const morning = MORNING_AFTER.exec(after);
  if (morning) return { ...reading, half: 'am', end: reading.end + morning[0].length };
  if (EVENING_ANYWHERE.test(text)) return { ...reading, half: 'pm' };
  if (MORNING_ANYWHERE.test(text)) return { ...reading, half: 'am' };
  return { ...reading, half: undefined };
}

/** A bare "evening", "pm", "de la mañana": the answer to "morning or evening?". */
export function readHalf(text: string): 'am' | 'pm' | undefined {
  if (/\b(?:pm|p\.m\.|evening|afternoon|night|tonight|tarde|noche)\b/i.test(text)) return 'pm';
  if (/\b(?:am|a\.m\.|morning|madrugada)\b|mañana/i.test(text)) return 'am';
  return undefined;
}

/** "today", "tomorrow", "pasado mañana"… as a New York date. "Por la mañana" is not a day. */
export function readDay(text: string, now: Date): DayReading | undefined {
  const today = newYorkDate(now);
  const after = /\b(?:the )?day after tomorrow\b|\bpasado mañana\b/i.exec(text);
  if (after) return { day: addDays(today, 2), ...span(after) };
  const tomorrow = /\btomorrow\b|(?<!(?:de|por|esta|la|media)\s)\bmañana(?![\p{L}])/iu.exec(text);
  if (tomorrow) return { day: addDays(today, 1), ...span(tomorrow) };
  const todayWord = /\b(?:today|tonight|hoy)\b|\besta (?:tarde|noche)\b/i.exec(text);
  if (todayWord) return { day: today, ...span(todayWord) };
  return undefined;
}

/** How far ahead Sara plans: the routing engine's timetables cover about a week. */
const MAX_DAYS_AHEAD = 7;

/** The instant to arrive by, read in New York time, or why there is none yet. */
export function arrivalFrom(
  clock: { readonly hour: number; readonly minute: number; readonly half: Half },
  day: string | null,
  now: Date,
): ArrivalReading {
  if (clock.half === undefined) {
    return { kind: 'ambiguous', pending: { day, hour: clock.hour, minute: clock.minute } };
  }
  const hour =
    clock.half === 'h24' ? clock.hour : (clock.hour % 12) + (clock.half === 'pm' ? 12 : 0);
  const at = atNewYorkTime(day ?? newYorkDate(now), hour, clock.minute);
  if (at === undefined || at.getTime() <= now.getTime()) {
    return { kind: 'passed', at: at ?? now };
  }
  if (at.getTime() - now.getTime() > MAX_DAYS_AHEAD * 24 * 60 * 60_000) return { kind: 'too-far' };
  return { kind: 'at', at };
}

/** The instant of a New York date and time, or undefined when that time does not exist. */
function atNewYorkTime(day: string, hour: number, minute: number): Date | undefined {
  const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
  return fromNewYorkWallClock({ year, month, day: date, hour, minute, second: 0 });
}

export function newYorkDate(instant: Date): string {
  return toNewYorkWallClockText(instant).slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const [year = 0, month = 0, date = 0] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

function span(match: RegExpExecArray): { start: number; end: number } {
  return { start: match.index, end: match.index + match[0].length };
}
