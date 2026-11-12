import type { CityDetail } from '@moviq/contracts';

import { useLocale } from '../../../../shared/i18n';
import { useCityCardT } from '../texts';
import { dayText, Fact, Group } from './Facts';

type Of<K extends CityDetail['kind']> = Extract<CityDetail, { kind: K }>;

/** A charging station as the AFDC lists it: never free or in use. */
export function ChargerBody({ detail }: { detail: Of<'charger'> }) {
  const t = useCityCardT();
  const locale = useLocale();
  const ports = [
    [t.charger.level1, detail.ports.level1],
    [t.charger.level2, detail.ports.level2],
    [t.charger.fast, detail.ports.fast],
  ] as const;
  return (
    <>
      <section className="ex-group">
        <p className={detail.listing === 'open' ? 'ex-v' : 'ex-v ex-risk'}>
          {t.charger.listing[detail.listing]}
        </p>
        <span className="ex-note">{detail.address}</span>
      </section>
      <Group title={t.charger.ports}>
        <div className="ex-movement">
          {ports
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <div className="ex-speed" key={label}>
                <span className="ex-k">{label}</span>
                <span className="ex-number">{count}</span>
              </div>
            ))}
        </div>
      </Group>
      <section className="ex-group">
        <Fact k={t.charger.network} v={detail.network} />
        <Fact k={t.charger.connectors} v={detail.connectors.join(', ')} />
        <Fact k={t.charger.access} v={detail.access} />
        <Fact k={t.charger.hours} v={detail.hours} />
        <Fact k={t.charger.pricing} v={detail.pricing} />
        {detail.confirmedOn !== null && (
          <span className="ex-note">
            {t.charger.confirmed(dayText(detail.confirmedOn, locale))}
          </span>
        )}
        <span className="ex-note">{t.charger.never}</span>
      </section>
    </>
  );
}

/** A registered defibrillator: the building, the place inside and the units; no hours. */
export function DefibrillatorBody({ detail }: { detail: Of<'defibrillator'> }) {
  const t = useCityCardT();
  const locale = useLocale();
  return (
    <>
      <section className="ex-group">
        <p className="ex-v">{detail.address}</p>
        <Fact k={t.defibrillator.inside} v={detail.place} />
        <p className="ex-v">
          {detail.units === null ? t.defibrillator.noUnits : t.defibrillator.units(detail.units)}
        </p>
      </section>
      <section className="ex-group">
        <p className="ex-state ex-risk">{t.defibrillator.noHours}</p>
        {detail.updatedOn !== null && (
          <span className="ex-note">
            {t.defibrillator.updated(dayText(detail.updatedOn, locale))}
          </span>
        )}
      </section>
    </>
  );
}

/** Step-free entrances are the survey's `Elevator` and `Ramp`. */
const STEP_FREE = new Set(['Elevator', 'Ramp']);

/** A subway entrance of the 2024 survey: its kind and whether it lets people in or out. */
export function EntranceBody({ detail }: { detail: Of<'subway-entrance'> }) {
  const t = useCityCardT();
  const ways =
    detail.entry && detail.exit ? 'both' : detail.entry ? 'entry' : detail.exit ? 'exit' : 'none';
  return (
    <section className="ex-group">
      <Fact k={t.entrance.kind} v={detail.type} />
      {STEP_FREE.has(detail.type) && <p className="ex-v">{t.entrance.stepFree}</p>}
      <p className="ex-v">{t.entrance.ways[ways]}</p>
      <span className="ex-note">{t.entrance.survey}</span>
    </section>
  );
}

/** A parking meter in service: the rules printed on it, never a free space. */
export function MeterBody({ detail }: { detail: Of<'parking-meter'> }) {
  const t = useCityCardT();
  return (
    <section className="ex-group">
      <Fact k={t.meter.rules} v={detail.hours} />
      <Fact k={t.where} v={[detail.street, detail.side].filter(Boolean).join(' · ')} />
      {detail.from !== null && detail.to !== null && (
        <span className="ex-note">{`${detail.from} – ${detail.to}`}</span>
      )}
      {detail.facility !== null && (
        <span className="ex-note">{t.meter.facility[detail.facility]}</span>
      )}
      <span className="ex-note">{t.meter.active}</span>
    </section>
  );
}

/** A parking sign with its text as posted. */
export function SignBody({ detail }: { detail: Of<'parking-sign'> }) {
  const t = useCityCardT();
  const locale = useLocale();
  return (
    <section className="ex-group">
      <span className="ex-k">{t.sign.text}</span>
      <p className="ex-v mono">{detail.text}</p>
      <span className="ex-note">
        {[
          t.sign.code(detail.code),
          detail.side,
          detail.arrow === null || detail.arrow === '' ? null : t.sign.arrow(detail.arrow),
          detail.since === null ? null : t.sign.since(dayText(detail.since, locale)),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <span className="ex-note">{t.sign.never}</span>
    </section>
  );
}
