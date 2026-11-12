import type { Journey } from '@moviq/contracts';
import type { ReactNode } from 'react';

import { CityTime } from '../../../shared/journey/CityTime';
import { useNow } from '../../../shared/time/clock';
import { formatCityTime } from '../../../shared/time/city';
import { useLocale } from '../../../shared/i18n';
import { formatDuration } from '../../../shared/time/duration';
import { secondsSince } from '../../../shared/time/instant';
import { Icon } from '../../../shared/ui/Icon';
import { flightView, type FlightFact } from '../model/flight';
import { useTripT } from '../texts';

/** One fact: its name, its value and, aligned to the right, the source that gave it. */
function Row<T>({
  label,
  fact,
  children,
}: {
  label: string;
  fact: FlightFact<T>;
  children: ReactNode;
}) {
  const t = useTripT().flightPanel;
  return (
    <div className="fl-row" title={fact.evidence}>
      <dt>{label}</dt>
      <dd className="fl-value">{children}</dd>
      <dd className="fl-source">{t.sources[fact.sourceId] ?? fact.sourceId}</dd>
    </div>
  );
}

/**
 * The flight that sets the deadline: scheduled and revised times, terminal, gate and status,
 * each with its source; the departure the plan uses; where the sources disagree; and
 * AeroDataBox's attribution wherever its data is shown.
 */
export function FlightPanel({ journey }: { journey: Journey }) {
  const t = useTripT().flightPanel;
  const locale = useLocale();
  const now = useNow();
  const view = flightView(journey);
  if (view === null) return null;
  const { departure, revised, status, aerodatabox } = view;
  const source = (id: string) => t.sources[id] ?? id;
  const basis =
    departure === null
      ? null
      : departure.basis === 'boarding-pass'
        ? t.basis['boarding-pass'](formatCityTime(departure.at, locale))
        : t.basis[departure.basis](
            formatCityTime(departure.at, locale),
            source(departure.sourceId),
          );
  const answeredAt = aerodatabox?.provenance.dataTime ?? null;
  return (
    <section className="flight-panel" aria-labelledby="flight-title">
      <h2 id="flight-title">
        <Icon name="plane" />
        {t.title(view.code, view.airport)}
      </h2>
      <dl className="fl-rows">
        <Row label={t.scheduled} fact={view.scheduled}>
          <CityTime at={view.scheduled.value} />
        </Row>
        {revised !== null && (
          <Row label={t.revised[revised.value.kind]} fact={revised}>
            <CityTime at={revised.value.at} className={revised.value.minutes > 0 ? 'moved' : ''} />
            <small className="fl-shift">{t.shift(revised.value.minutes)}</small>
          </Row>
        )}
        {view.terminal !== null && (
          <Row label={t.terminal} fact={view.terminal}>
            {view.terminal.value}
          </Row>
        )}
        {view.gate !== null && (
          <Row label={t.gate} fact={view.gate}>
            {view.gate.value ?? <span className="fl-none">{t.notAnnounced}</span>}
          </Row>
        )}
        {status !== null && (
          <Row label={t.status} fact={status}>
            {status.value.kind === 'movement'
              ? t.movement[status.value.phase]
              : (t.statuses[status.value.word] ?? status.value.word)}
          </Row>
        )}
      </dl>
      {basis !== null && <p className="fl-basis">{basis}</p>}
      {view.discrepancies.length > 0 && (
        <div className="fl-disagree">
          <h3>{t.disagree}</h3>
          <ul>
            {view.discrepancies.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {aerodatabox !== null && (
        <p className="fl-credit">
          {t.attribution}{' '}
          <a href="https://aerodatabox.com" target="_blank" rel="noopener noreferrer">
            AeroDataBox
          </a>
          {answeredAt !== null && (
            <span className="fl-age">
              {` · ${t.updated(formatDuration(secondsSince(answeredAt, now)))}`}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
