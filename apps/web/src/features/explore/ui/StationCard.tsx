import type { AirportProgram, LiveSource, LiveStation } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { formatCityTime } from '../../../shared/time/city';
import { Icon } from '../../../shared/ui/Icon';
import { useExploreT } from '../texts';
import type { ExploreDict } from '../texts-en';
import { ParkedBody, RailStationBody } from './PlaceBodies';
import { SourceCredit } from './SourceCredit';

interface Props {
  readonly station: LiveStation;
  readonly source: LiveSource | undefined;
  readonly now: number;
  readonly onClose: () => void;
}

/** One FAA program in the FAA's own words, after a plain title. */
function programLine(program: AirportProgram, t: ExploreDict): { title: string; detail: string } {
  const parts: string[] = [];
  if (program.reason !== null) parts.push(program.reason);
  switch (program.kind) {
    case 'ground-stop':
      if (program.until !== null) parts.push(t.airport.until(program.until));
      return { title: t.airport['ground-stop'], detail: parts.join(' · ') };
    case 'ground-delay':
      if (program.average !== null) parts.push(t.airport.average(program.average.text));
      if (program.maximum !== null) parts.push(t.airport.upTo(program.maximum.text));
      return { title: t.airport['ground-delay'], detail: parts.join(' · ') };
    case 'delay':
      if (program.maximum !== null) parts.push(t.airport.upTo(program.maximum.text));
      return { title: t.airport[`delay-${program.direction}`], detail: parts.join(' · ') };
    case 'closure':
      if (program.reopens !== null) parts.push(t.airport.reopens(program.reopens));
      return { title: t.airport.closure, detail: parts.join(' · ') };
  }
}

function AirportBody({
  station,
  t,
}: {
  station: Extract<LiveStation, { mode: 'airport' }>;
  t: ExploreDict;
}) {
  const locale = useLocale();
  return (
    <section className="ex-group" aria-label={t.airport.status}>
      <span className="ex-k">{t.airport.status}</span>
      {station.programs.length === 0 ? (
        <p className="ex-state">{t.airport.none}</p>
      ) : (
        <ul className="ex-programs">
          {station.programs.map((program, index) => {
            const line = programLine(program, t);
            return (
              <li key={`${program.kind}-${String(index)}`}>
                <span className="ex-v ex-late">{line.title}</span>
                {line.detail !== '' && <span className="ex-note">{line.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <span className="ex-note">
        {t.airport.updated(formatCityTime(station.updatedAt, locale))}
      </span>
    </section>
  );
}

function BikeBody({
  station,
  t,
}: {
  station: Extract<LiveStation, { mode: 'bike-station' }>;
  t: ExploreDict;
}) {
  const locale = useLocale();
  return (
    <section className="ex-group" aria-label={t.modes['bike-station']}>
      <div className="ex-movement">
        <div className="ex-speed">
          <span className="ex-k">{t.bikes.bikes}</span>
          <span className="ex-v">
            <span className="ex-number">{station.bikes}</span>
          </span>
          {station.ebikes !== null && (
            <span className="ex-note">{t.bikes.ebikes(station.ebikes)}</span>
          )}
        </div>
        <div className="ex-speed">
          <span className="ex-k">{t.bikes.docks}</span>
          <span className="ex-v">
            <span className="ex-number">{station.docks}</span>
          </span>
        </div>
      </div>
      {!station.renting && <p className="ex-state ex-late">{t.bikes.closed}</p>}
      <span className="ex-note">
        {t.bikes.reported(formatCityTime(station.reportedAt, locale))}
      </span>
    </section>
  );
}

/** The name of a place on its card, and what it is under the name. */
function titlesOf(station: LiveStation, t: ExploreDict): { title: string; kind: string } {
  switch (station.mode) {
    case 'airport':
      return { title: `${station.name} (${station.code})`, kind: t.modeOne.airport };
    case 'rail-station':
      return { title: station.name, kind: `${station.network} · ${t.modeOne['rail-station']}` };
    case 'micromobility':
      return {
        title: `${t.craft.parked.kinds[station.kind ?? 'unknown']} · ${station.name}`,
        kind: t.modeOne.micromobility,
      };
    case 'bike-station':
      return { title: station.name, kind: t.modeOne['bike-station'] };
  }
}

function PlaceBody({ station, now, t }: { station: LiveStation; now: number; t: ExploreDict }) {
  switch (station.mode) {
    case 'airport':
      return <AirportBody station={station} t={t} />;
    case 'rail-station':
      return <RailStationBody station={station} now={now} />;
    case 'micromobility':
      return <ParkedBody station={station} />;
    case 'bike-station':
      return <BikeBody station={station} t={t} />;
  }
}

/**
 * The card of a place with a live state: an airport and its FAA programs, a bike station, a
 * PATH station and its next trains, or a scooter or bike parked in the street.
 */
export function StationCard({ station, source, now, onClose }: Props) {
  const t = useExploreT();
  const { title, kind } = titlesOf(station, t);
  return (
    <article className="ex-card" aria-label={title}>
      <header className="ex-card-head">
        <div className="ex-card-id">
          <h2>{title}</h2>
          <button type="button" className="ex-close" onClick={onClose} aria-label={t.card.close}>
            <Icon name="close" />
          </button>
        </div>
        <p className="ex-longname">{kind}</p>
      </header>
      <PlaceBody station={station} now={now} t={t} />
      {source !== undefined && (
        <footer className="ex-foot">
          <SourceCredit source={source} />
        </footer>
      )}
    </article>
  );
}
