import type { BoundingBox, LiveLine, LiveMode, LiveVehicle } from '@moviq/contracts';
import { useLang } from '../../../shared/i18n/lang';
import { useT } from '../../../shared/i18n';
import { CityPanel, TransportLayers } from '../city/ui/CityPanel';
import type { CityLayersView } from '../city/useCityLayers';
import type { RadarView } from '../city/useRadar';
import { EventsPanel } from '../events/ui/EventsPanel';
import type { EventLayer } from '../events/useEvents';
import type { useLineSelection } from '../live/useLineSelection';
import type { useLineCatalog } from '../live/useLineCatalog';
import { ageText } from '../model/card';
import { UNAVAILABLE_STATES } from '../model/city-now';
import { lineKey, matchesLine, OTHER_MODES } from '../model/line-selection';
import { CityNow } from './CityNow';
import { useExploreT } from '../texts';
import { Nearby } from './Nearby';
import { SearchLines } from './LineSearch';
import { WORDS, network } from './your-map-words';
import './your-map.css';

type Choice = ReturnType<typeof useLineSelection>;
type Catalog = ReturnType<typeof useLineCatalog>;
function LineRow({
  line,
  catalog,
  vehicles,
  now,
  onOpen,
  onRemove,
}: {
  line: LiveLine;
  catalog: Catalog;
  vehicles: readonly LiveVehicle[];
  now: number;
  onOpen: (id: string) => void;
  onRemove: (line: LiveLine) => void;
}) {
  const lang = useLang();
  const w = WORDS[lang];
  const t = useExploreT();
  const states = useT().states;
  const current = catalog.data?.lines.find((item) => lineKey(item) === lineKey(line));
  const source = catalog.data?.sources.find((item) => item.provenance.sourceId === line.sourceId);
  const count = current?.vehicleCount ?? 0;
  const live = vehicles.filter((vehicle) => matchesLine(vehicle, [line]));
  const age =
    source?.provenance.dataTime === null || source?.provenance.dataTime === undefined
      ? null
      : ageText(Math.max(0, (now - Date.parse(source.provenance.dataTime)) / 1000));
  const unavailable = source === undefined || UNAVAILABLE_STATES.includes(source.provenance.state);
  return (
    <li className="your-line">
      <div className="your-line-head">
        <strong>{line.name}</strong>
        <button
          type="button"
          className="ex-link"
          aria-label={`${w.remove} ${line.name} · ${network(line, catalog)}`}
          onClick={() => {
            onRemove(line);
          }}
        >
          {w.remove}
        </button>
      </div>
      <p>
        {t.modes[line.mode]} · {network(line, catalog)}
      </p>
      {line.longName && <p className="ex-note">{line.longName}</p>}
      <p className="ex-note">
        {unavailable
          ? w.noSource
          : count === 0
            ? w.noVehicles
            : `${String(count)} ${w.city} · ${String(live.length)} ${w.inView}`}
      </p>
      {source && (
        <p className="ex-note">
          {states[source.provenance.state].label}
          {age === null ? '' : ` · ${t.sourceAge(age)}`}
        </p>
      )}
      <details>
        <summary>{w.vehicles}</summary>
        {live.length === 0 ? (
          <p className="ex-note">{w.noView}</p>
        ) : (
          <Nearby vehicles={live} now={now} onOpen={onOpen} />
        )}
      </details>
    </li>
  );
}

export function YourMap({
  choice,
  catalog,
  vehicles,
  now,
  onOpen,
  onRemove,
  onToggleOther,
  city,
  radar,
  box,
  events,
}: {
  choice: Choice;
  catalog: Catalog;
  vehicles: readonly LiveVehicle[];
  now: number;
  onOpen: (id: string) => void;
  onRemove: (line: LiveLine) => void;
  onToggleOther: (mode: LiveMode) => void;
  city: CityLayersView;
  radar: RadarView;
  box: BoundingBox;
  events: EventLayer;
}) {
  const w = WORDS[useLang()];
  const t = useExploreT();
  const cityProps = { city, radar, box, now, onOpen };
  const wholeCity = choice.lines.length === 0 && choice.others.size === 0;
  return (
    <div className="your-map">
      <header>
        <h1>{w.title}</h1>
        {wholeCity && <p>{w.intro}</p>}
      </header>
      <SearchLines choice={choice} catalog={catalog} />
      {wholeCity && <CityNow catalog={catalog} now={now} />}
      {choice.lines.length > 0 && (
        <section>
          <h2 className="ex-eyebrow">{w.onMap}</h2>
          <ul className="your-lines">
            {choice.lines.map((line) => (
              <LineRow
                key={lineKey(line)}
                {...{ line, catalog, vehicles, now, onOpen, onRemove }}
              />
            ))}
          </ul>
        </section>
      )}
      <details>
        <summary>{w.other}</summary>
        <div className="your-others">
          {OTHER_MODES.map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={choice.others.has(mode)}
                onChange={() => {
                  onToggleOther(mode);
                }}
              />
              {t.modes[mode]}
            </label>
          ))}
        </div>
      </details>
      <details>
        <summary>{w.layers}</summary>
        <TransportLayers {...cityProps} />
        <EventsPanel layer={events} onOpen={onOpen} />
        <CityPanel {...cityProps} destination={null} />
      </details>
    </div>
  );
}
