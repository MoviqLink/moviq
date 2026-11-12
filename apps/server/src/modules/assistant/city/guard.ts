import type { CityResult } from './words.js';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** Clock times, checked on their own against the times the sources gave. */
const CLOCK = /\b\d{1,2}[:.]\d{2}\s*(?:[ap]\.?\s?m\.?)?|\b\d{1,2}\s*[ap]\.?\s?m\.?/gi;
const NUMBER = /\d+(?:[.,]\d+)?/g;

/** Every instant the city tools gave this turn, so a time the model says can be checked. */
export function cityInstants(results: readonly CityResult[]): string[] {
  const instants: string[] = [];
  JSON.stringify(results, (_, value: unknown) => {
    if (typeof value === 'string' && INSTANT.test(value)) instants.push(value);
    return value;
  });
  return instants;
}

const PUBLISHED_CLOCK = /(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s?m\b\.?)?/gi;

/** The minutes of the day of a clock time as a text writes it; none for a bare number. */
function minutesOf(hourText: string, minuteText: string | undefined, half: string | undefined) {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if ((minuteText === undefined && half === undefined) || hour > 24 || minute > 59) return [];
  if (half !== undefined) {
    return [((hour % 12) + (half.toLowerCase() === 'p' ? 12 : 0)) * 60 + minute];
  }
  return [hour * 60 + minute, ((hour % 12) + 12) * 60 + minute];
}

/**
 * Every clock time written in the texts the city tools gave this turn, as the city publishes a
 * restroom's hours (`8am-4pm`, `10:00 am - 6:00 pm`, `7 a.m.-7 p.m.`), so the model may repeat
 * them; a time without am or pm counts for either half of the day.
 */
export function cityWrittenMinutes(results: readonly CityResult[]): Set<number> {
  const minutes = new Set<number>();
  JSON.stringify(results, (_, value: unknown) => {
    if (typeof value !== 'string' || INSTANT.test(value)) return value;
    for (const [, hour = '', minute, half] of value.matchAll(PUBLISHED_CLOCK)) {
      for (const one of minutesOf(hour, minute, half)) minutes.add(one);
    }
    return value;
  });
  return minutes;
}

/**
 * A number in the model's words that neither the tools' answers nor the traveller's message hold:
 * a count, a minute or a percentile the model made up. Clock times are checked apart.
 */
export function unknownNumber(text: string, given: readonly string[]): boolean {
  const known = new Set(given.flatMap((part) => part.match(NUMBER) ?? []));
  const said = text.replace(CLOCK, ' ').match(NUMBER) ?? [];
  return said.some((number) => !known.has(number));
}

const TIME_IN_TEXT = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?![\d])/gi;

/**
 * A clock time in the words that is none of the `known` minutes of the day (hour × 60 +
 * minute). A time without am or pm may be either half of the day.
 */
export function unknownClock(text: string, known: ReadonlySet<number>): boolean {
  for (const match of text.matchAll(TIME_IN_TEXT)) {
    const [, hourText = '', minuteText, half] = match;
    if (minuteText === undefined && half === undefined) continue;
    const hour = Number(hourText);
    const minute = Number(minuteText ?? 0);
    const candidates =
      half === undefined
        ? [hour * 60 + minute, ((hour % 12) + 12) * 60 + minute]
        : [((hour % 12) + (half.toLowerCase().startsWith('p') ? 12 : 0)) * 60 + minute];
    if (!candidates.some((candidate) => known.has(candidate))) return true;
  }
  return false;
}

const WRITTEN_CLOCK = /(?<![\d:])(\d{1,2}):(\d{2})(?:\s*([ap])\.?\s?m\b\.?)?/gi;

/** The minutes of the day of every clock time written in the texts, as `18:52` or `6:52 pm`. */
export function writtenMinutes(texts: readonly string[]): Set<number> {
  const minutes = new Set<number>();
  for (const text of texts) {
    for (const [, hourText = '', minuteText = '', half] of text.matchAll(WRITTEN_CLOCK)) {
      const hour = Number(hourText);
      const shift = half === undefined ? 0 : half.toLowerCase() === 'p' ? 12 : 0;
      minutes.add((half === undefined ? hour : (hour % 12) + shift) * 60 + Number(minuteText));
    }
  }
  return minutes;
}

const SPANISH = /\b(el|la|los|las|de|del|que|en|tu|para|con|un|una|es|y|por|sal|llegar|minutos)\b/g;
const ENGLISH = /\b(the|and|you|your|to|of|is|will|with|for|on|from|leave|arrive|minutes)\b/g;

/** Whether the words are in the traveller's language, judged by their commonest words. */
export function inLanguage(text: string, lang: 'en' | 'es'): boolean {
  const lower = text.toLowerCase();
  const es = (lower.match(SPANISH) ?? []).length;
  const en = (lower.match(ENGLISH) ?? []).length;
  if (es + en < 3) return true;
  return lang === 'es' ? es > en : en >= es;
}
