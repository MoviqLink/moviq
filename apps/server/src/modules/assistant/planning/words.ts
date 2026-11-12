import { toNewYorkWallClockText } from '../../../infrastructure/clock/new-york.js';
import { addDays, newYorkDate } from '../understanding/time-words.js';
import type { Lang } from './state.js';

/** The English or the Spanish words, in the traveller's language. */
export type Words = (en: string, es: string) => string;

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ],
};

/** "6:20 pm" in English, "18:20" in Spanish, in New York time. */
export function time(instant: Date, lang: Lang): string {
  const [hour = 0, minute = 0] = toNewYorkWallClockText(instant)
    .slice(11, 16)
    .split(':')
    .map(Number);
  const minutes = String(minute).padStart(2, '0');
  if (lang === 'es') return `${String(hour)}:${minutes}`;
  const half = hour < 12 ? 'am' : 'pm';
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${minutes} ${half}`;
}

/** Nothing for today, then "tomorrow" or the date, in the traveller's language. */
export function day(instant: Date, lang: Lang, now: Date): string {
  const date = newYorkDate(instant);
  const today = newYorkDate(now);
  if (date === today) return '';
  if (date === addDays(today, 1)) return lang === 'es' ? ' mañana' : ' tomorrow';
  const [, month = 1, dayOfMonth = 1] = date.split('-').map(Number);
  return lang === 'es'
    ? ` el ${String(dayOfMonth)} de ${MONTHS.es[month - 1] ?? ''}`
    : ` on ${MONTHS.en[month - 1] ?? ''} ${String(dayOfMonth)}`;
}
