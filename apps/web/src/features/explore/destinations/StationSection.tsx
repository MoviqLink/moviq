import type { LiveSource, LiveStation, LiveVehicle } from '@moviq/contracts';
import type { LiveCityView } from '../live/useLiveCity';
import { useExploreT } from '../texts';
import type { CityLayersView } from '../city/useCityLayers';
import { CityItems } from './CityItems';
import { SourceLine } from './SourceLine';
import { useDestinationT } from './texts';

function StationRow({
  id,
  title,
  subtitle,
  source,
  onOpen,
}: {
  id: string;
  title: string;
  subtitle: string;
  source: LiveSource | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onOpen(id);
        }}
      >
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </button>
      <SourceLine source={source} />
    </li>
  );
}

function unavailableModes(live: LiveCityView) {
  return (live.data?.modes ?? []).filter(
    (mode) =>
      (mode.mode === 'bus' || mode.mode === 'subway' || mode.mode === 'rail') &&
      (mode.status === 'unavailable' || mode.status === 'not-connected'),
  );
}

export function StationSection({
  live,
  stations,
  vehicles,
  city,
  query,
  onOpen,
}: {
  live: LiveCityView;
  stations: readonly LiveStation[];
  vehicles: readonly LiveVehicle[];
  city: CityLayersView;
  query: string;
  onOpen: (id: string) => void;
}) {
  const t = useDestinationT();
  const ex = useExploreT();
  const pending = live.data === null;
  const missing = unavailableModes(live);
  const needle = query.toLocaleLowerCase();
  const places = stations.filter(
    (station) =>
      (station.mode === 'rail-station' || station.mode === 'bike-station') &&
      station.name.toLocaleLowerCase().includes(needle),
  );
  const lines = new Map<string, LiveVehicle>();
  for (const vehicle of vehicles)
    if (vehicle.line?.name.toLocaleLowerCase().includes(needle) === true)
      lines.set(`${vehicle.mode}:${vehicle.line.id}`, vehicle);
  return (
    <>
      <h2>{t.lines}</h2>
      {pending && <p role="status">{live.failing ? t.unavailable : t.loading}</p>}
      {live.failing && <p role="status">{t.failed}</p>}
      {missing.length > 0 && (
        <p role="status">
          {t.missingModes}: {missing.map((mode) => ex.modes[mode.mode]).join(', ')}
        </p>
      )}
      <ul className="destination-list">
        {[...lines.values()]
          .sort((a, b) => (a.line?.name ?? '').localeCompare(b.line?.name ?? ''))
          .slice(0, 30)
          .map((vehicle) => (
            <StationRow
              key={`${vehicle.mode}:${vehicle.line?.id ?? ''}`}
              id={vehicle.id}
              title={vehicle.line?.name ?? ''}
              subtitle={`${ex.modes[vehicle.mode]} · ${t.observed}`}
              source={live.data?.sources.find(
                (source) => source.provenance.sourceId === vehicle.sourceId,
              )}
              onOpen={onOpen}
            />
          ))}
      </ul>
      {!pending && !live.failing && missing.length === 0 && lines.size === 0 && <p>{t.none}</p>}
      {lines.size > 30 && <p>{t.limit}</p>}
      <h2>{t.stops}</h2>
      <ul className="destination-list">
        {places.slice(0, 30).map((station) => (
          <StationRow
            key={station.id}
            id={station.id}
            title={station.name}
            subtitle={ex.modes[station.mode]}
            source={live.data?.sources.find(
              (source) => source.provenance.sourceId === station.sourceId,
            )}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {places.length > 30 && <p>{t.limit}</p>}
      <CityItems city={city} layers={['subway-entrances']} query={query} onOpen={onOpen} />
    </>
  );
}
