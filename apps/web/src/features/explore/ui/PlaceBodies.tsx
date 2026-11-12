import type { LiveStation } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { minutesUntil } from '../model/modes';
import { useExploreT } from '../texts';

type Of<M extends LiveStation['mode']> = Extract<LiveStation, { mode: M }>;

/** A train station without trains on the map: the next trains its operator announces. */
export function RailStationBody({ station, now }: { station: Of<'rail-station'>; now: number }) {
  const t = useExploreT();
  const locale = useLocale();
  const words = t.craft.path;
  return (
    <section className="ex-group" aria-label={words.next}>
      <span className="ex-k">{words.next}</span>
      {station.arrivals.length === 0 ? (
        <p className="ex-state">{words.none}</p>
      ) : (
        <ol className="ex-arrivals">
          {station.arrivals.map((arrival) => (
            <li key={`${arrival.headsign}-${arrival.arrival}`}>
              <span className="ex-v">{arrival.headsign}</span>
              <span className="ex-note">{words.inMinutes(minutesUntil(arrival.arrival, now))}</span>
              <time className="mono">{formatCityTime(arrival.arrival, locale)}</time>
            </li>
          ))}
        </ol>
      )}
      <span className="ex-note">{words.updated(formatCityTime(station.updatedAt, locale))}</span>
    </section>
  );
}

/** A scooter or bike parked in the street: its kind, battery and range, and its report. */
export function ParkedBody({ station }: { station: Of<'micromobility'> }) {
  const t = useExploreT();
  const locale = useLocale();
  const words = t.craft.parked;
  const range = station.rangeMeters;
  return (
    <section className="ex-group" aria-label={words.state}>
      <p className="ex-state">{words.state}</p>
      <div className="ex-movement">
        <div className="ex-speed">
          <span className="ex-k">{words.battery}</span>
          {station.battery === null ? (
            <span className="ex-v ex-none">—</span>
          ) : (
            <span className="ex-v">
              <span className="ex-number">{Math.round(station.battery * 100)}</span>
              <small>%</small>
            </span>
          )}
          {station.battery === null && <span className="ex-note">{words.notGiven}</span>}
        </div>
        <div className="ex-speed">
          <span className="ex-k">{words.range}</span>
          {range === null ? (
            <span className="ex-v ex-none">—</span>
          ) : (
            <span className="ex-v">
              <span className="ex-number">
                {(range / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}
              </span>
              <small>{words.km}</small>
            </span>
          )}
          {range === null && <span className="ex-note">{words.notGiven}</span>}
        </div>
      </div>
      {!station.stableId && <p className="ex-note">{words.rotating}</p>}
      <span className="ex-note">{words.reported(formatCityTime(station.reportedAt, locale))}</span>
    </section>
  );
}
