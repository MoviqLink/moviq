import type { ReactNode } from 'react';

import { useLocale } from '../../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../../shared/time/city';

const yearOf = (instant: string) =>
  new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/New_York' }).format(
    new Date(instant),
  );

/**
 * `19:30` on the day of `now`, `Thu, Nov 12 · 19:30` another day of its year, and with the year
 * when it is another year, in New York time.
 */
export function whenText(instant: string, locale: string, now: number): string {
  const time = formatCityTime(instant, locale);
  const day = formatCityDay(instant, locale);
  const today = new Date(now).toISOString();
  if (day === formatCityDay(today, locale)) return time;
  const year = yearOf(instant) === yearOf(today) ? '' : ` ${yearOf(instant)}`;
  return `${day}${year} · ${time}`;
}

/** A New York day of the calendar (`2026-11-11`) as the card writes days. */
export function dayText(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The writer of times for this card: in New York time, with the day when it is not today. */
export function useWhen(now: number): (instant: string) => string {
  const locale = useLocale();
  return (instant) => whenText(instant, locale, now);
}

/** A label and its value on one row; nothing at all when the source gives no value. */
export function Fact({ k, v }: { k: string; v: ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="ex-row">
      <span className="ex-k">{k}</span>
      <span className="ex-v">{v}</span>
    </div>
  );
}

/** A group of the card with its title. */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ex-group" aria-label={title}>
      <span className="ex-k">{title}</span>
      {children}
    </section>
  );
}
