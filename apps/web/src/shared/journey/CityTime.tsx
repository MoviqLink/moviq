import { useLocale } from '../i18n';
import { cityTimeParts } from '../time/city';

/** A New York time with tabular figures; the period, when the language has one, set smaller. */
export function CityTime({ at, className }: { at: string; className?: string }) {
  const { time, period } = cityTimeParts(at, useLocale());
  return (
    <time
      dateTime={at}
      className={className === undefined ? 'city-time' : `city-time ${className}`}
    >
      {time}
      {period !== null && <small>{period}</small>}
    </time>
  );
}
