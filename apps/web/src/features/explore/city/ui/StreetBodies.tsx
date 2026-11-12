import type { CityDetail } from '@moviq/contracts';

import { useLocale } from '../../../../shared/i18n';
import { useCityCardT } from '../texts';
import { dayText, Fact, Group, useWhen } from './Facts';

type Of<K extends CityDetail['kind']> = Extract<CityDetail, { kind: K }>;

/** A 511NY event in its own words, with its agency, its periods and the time of its update. */
export function RoadEventBody({ detail, now }: { detail: Of<'road-event'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <>
      <section className="ex-group">
        <p className={`ex-state${detail.active ? ' ex-risk' : ''}`}>
          {detail.headline} · {detail.active ? t.road.active : t.road.inactive}
        </p>
        {detail.description !== '' && <p className="ex-city-text">{detail.description}</p>}
      </section>
      <Group title={t.when}>
        {detail.periods.length === 0 ? (
          <Fact k={t.from} v={detail.startsAt === null ? null : when(detail.startsAt)} />
        ) : (
          detail.periods.map((period) => (
            <div className="ex-row" key={period.from}>
              <span className="ex-v mono">{when(period.from)}</span>
              <span className="ex-note">
                {period.to === null ? t.noEnd : `${t.until} ${when(period.to)}`}
              </span>
            </div>
          ))
        )}
      </Group>
      {detail.place !== null && detail.place !== '' && (
        <Group title={t.where}>
          <p className="ex-city-text">{detail.place}</p>
        </Group>
      )}
      <section className="ex-group">
        <Fact k={t.agency} v={detail.agency} />
        <span className="ex-note">
          {detail.updatedAt === null ? t.road.noUpdate : t.road.updated(when(detail.updatedAt))}
        </span>
        <span className="ex-note">{t.road.asIs}</span>
      </section>
    </>
  );
}

/** A block NYC DOT closes for construction: the street, the stretch, the work and the days. */
export function StreetClosureBody({ detail }: { detail: Of<'street-closure'> }) {
  const t = useCityCardT();
  const locale = useLocale();
  return (
    <>
      <Group title={t.where}>
        <p className="ex-v">{detail.street}</p>
        {detail.from !== null && detail.to !== null && (
          <span className="ex-note">
            {t.closure.between(detail.from, detail.to)} · {detail.borough}
          </span>
        )}
      </Group>
      <Group title={t.when}>
        <p className="ex-v">
          {t.closure.days(dayText(detail.firstDay, locale), dayText(detail.lastDay, locale))}
        </p>
        <span className="ex-note">{t.closure.noHours}</span>
      </Group>
      <section className="ex-group">
        <Fact k={t.closure.work} v={detail.purpose} />
      </section>
    </>
  );
}

/** An event with a permit: what, who issued it, where in words, and what it closes. */
export function PermittedEventBody({
  detail,
  now,
}: {
  detail: Of<'permitted-event'>;
  now: number;
}) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <>
      <Group title={t.permitted.closure}>
        <p className={detail.closure === null || detail.closure === '' ? 'ex-v' : 'ex-v ex-risk'}>
          {detail.closure === null || detail.closure === ''
            ? t.permitted.noClosure
            : detail.closure}
        </p>
        {detail.side !== null && detail.side !== '' && (
          <span className="ex-note">{t.permitted.side(detail.side)}</span>
        )}
      </Group>
      <Group title={t.when}>
        <Fact k={t.from} v={when(detail.startsAt)} />
        <Fact k={t.until} v={when(detail.endsAt)} />
      </Group>
      {detail.stretches.length > 1 && (
        <Group title={t.permitted.stretches}>
          <ul className="ex-city-breakdown">
            {detail.stretches.map((stretch) => (
              <li key={stretch.startsAt}>
                <span>{when(stretch.startsAt)}</span>
                <span className="mono">{when(stretch.endsAt)}</span>
              </li>
            ))}
          </ul>
        </Group>
      )}
      <Group title={t.where}>
        <p className="ex-city-text">{detail.location}</p>
        <span className="ex-note">{detail.borough}</span>
      </Group>
      <section className="ex-group">
        <Fact k={t.permitted.kind} v={detail.type} />
        <Fact k={t.agency} v={detail.agency} />
      </section>
    </>
  );
}

/** A PATH or ferry alert: its text as sent, what it names and when. */
export function TransitAlertBody({ detail, now }: { detail: Of<'transit-alert'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <>
      <section className="ex-group">
        <Fact k={t.transit.network} v={detail.network} />
        {detail.sentAt !== null && (
          <span className="ex-note">{t.transit.sent(when(detail.sentAt))}</span>
        )}
        {detail.closed && <p className="ex-note">{t.transit.closed}</p>}
        {detail.text !== '' && <p className="ex-city-text">{detail.text}</p>}
      </section>
      {detail.periods.length > 0 && (
        <Group title={t.when}>
          {detail.periods.map((period, index) => (
            <p className="ex-v mono" key={`${period.from ?? ''}-${String(index)}`}>
              {period.from === null ? '' : when(period.from)}
              {' – '}
              {period.to === null ? t.noEnd : when(period.to)}
            </p>
          ))}
        </Group>
      )}
      {detail.names.length > 0 && (
        <Group title={t.transit.names}>
          <p className="ex-v">{detail.names.join(', ')}</p>
        </Group>
      )}
    </>
  );
}
