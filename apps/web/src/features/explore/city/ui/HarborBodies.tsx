import type { CityDetail } from '@moviq/contracts';

import { useLocale } from '../../../../shared/i18n';
import { Icon } from '../../../../shared/ui/Icon';
import { useCityCardT } from '../texts';
import { Fact, Group, useWhen } from './Facts';

type Of<K extends CityDetail['kind']> = Extract<CityDetail, { kind: K }>;

/** A ship call at Port Newark: its stage and the expected and actual times. */
export function VesselCallBody({ detail, now }: { detail: Of<'vessel-call'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  const pair = (expected: string | null, actual: string | null) =>
    [
      expected === null ? null : t.vessel.expected(when(expected)),
      actual === null ? null : t.vessel.actual(when(actual)),
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <section className="ex-group">
      <p className="ex-v">{t.vessel.stage[detail.stage]}</p>
      <Fact k={t.vessel.arrival} v={pair(detail.expectedArrival, detail.arrived)} />
      <Fact k={t.vessel.departure} v={pair(detail.expectedDeparture, detail.departed)} />
      <Fact k={t.vessel.line} v={detail.line} />
    </section>
  );
}

/** The latest NOAA PORTS measurement, in the units NOAA gives. */
export function HarborReadingBody({ detail, now }: { detail: Of<'harbor-reading'>; now: number }) {
  const t = useCityCardT();
  const locale = useLocale();
  const when = useWhen(now);
  const n = (value: number, digits = 1) =>
    value.toLocaleString(locale, { maximumFractionDigits: digits });
  const { reading } = detail;
  const value = (() => {
    switch (reading.measure) {
      case 'water-level':
        return { big: n(reading.metresAboveChartDatum, 2), unit: t.harbor.aboveDatum };
      case 'air-gap':
        return { big: n(reading.metres, 2), unit: t.harbor.underBridge };
      case 'current':
        return {
          big: n(reading.centimetresPerSecond),
          unit: t.harbor.towards(n(reading.directionDegrees, 0)),
        };
      case 'wind':
        return {
          big: n(reading.metresPerSecond),
          unit: t.harbor.fromDirection(n(reading.directionDegrees, 0)),
        };
    }
  })();
  return (
    <section className="ex-group">
      <span className="ex-k">{t.harbor[reading.measure]}</span>
      <p className="ex-v">
        <span className="ex-number">{value.big}</span> <span className="ex-note">{value.unit}</span>
      </p>
      {reading.measure === 'wind' && reading.gustMetresPerSecond !== null && (
        <span className="ex-note">{t.harbor.gusts(n(reading.gustMetresPerSecond))}</span>
      )}
      {reading.measure === 'water-level' && reading.preliminary && (
        <span className="ex-note">{t.harbor.preliminary}</span>
      )}
      {'flagged' in reading && reading.flagged && (
        <p className="ex-state ex-risk">{t.harbor.flagged}</p>
      )}
      <span className="ex-note mono">{t.harbor.measured(when(detail.observedAt))}</span>
    </section>
  );
}

/** A Coast Guard notice to mariners, its text as broadcast without its contact line. */
export function NoticeBody({ detail, now }: { detail: Of<'notice'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <>
      <section className="ex-group">
        <p className="ex-v">{[detail.category, detail.subject].filter(Boolean).join(' · ')}</p>
        <span className="ex-note">{t.notice.published(when(detail.publishedAt))}</span>
        <Fact k={t.until} v={detail.endsAt === null ? t.noEnd : when(detail.endsAt)} />
        <Fact k={t.notice.reference} v={detail.reference} />
      </section>
      <section className="ex-group">
        <p className="ex-city-text">{detail.text}</p>
        {detail.link !== null && (
          <a
            className="ex-ev-official"
            href={detail.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.notice.official}
            <Icon name="external" />
          </a>
        )}
      </section>
    </>
  );
}

/** The surface of a road segment in NYSDOT's words. */
export function RoadConditionBody({ detail, now }: { detail: Of<'road-condition'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <section className="ex-group">
      <span className="ex-k">{t.condition.surface}</span>
      <p className="ex-v">{detail.condition}</p>
      <Fact k={t.where} v={detail.between} />
      {detail.updatedAt !== null && (
        <span className="ex-note">{t.condition.updated(when(detail.updatedAt))}</span>
      )}
    </section>
  );
}

/** A National Weather Service alert: severity, when, where and what to do, as it is sent. */
export function WeatherAlertBody({ detail, now }: { detail: Of<'weather-alert'>; now: number }) {
  const t = useCityCardT();
  const when = useWhen(now);
  return (
    <>
      <section className="ex-group">
        <p className="ex-state ex-risk">{t.weather.severity[detail.severity]}</p>
        {detail.headline !== null && <p className="ex-v">{detail.headline}</p>}
      </section>
      <Group title={t.when}>
        <Fact k={t.from} v={when(detail.startsAt)} />
        <Fact k={t.until} v={detail.endsAt === null ? t.noEnd : when(detail.endsAt)} />
        <span className="ex-note">{t.weather.expires(when(detail.expiresAt))}</span>
      </Group>
      <Group title={t.weather.area}>
        <p className="ex-city-text">{detail.area}</p>
      </Group>
      {detail.description !== null && detail.description !== '' && (
        <p className="ex-city-text">{detail.description}</p>
      )}
      {detail.instruction !== null && detail.instruction !== '' && (
        <Group title={t.weather.instruction}>
          <p className="ex-city-text">{detail.instruction}</p>
        </Group>
      )}
      <span className="ex-note">{detail.sender}</span>
    </>
  );
}
