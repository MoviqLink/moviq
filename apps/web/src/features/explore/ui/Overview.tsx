import type { BoundingBox, LiveMode, LiveVehicle } from '@moviq/contracts';

import { useLocale } from '../../../shared/i18n';
import { CityPanel, TransportLayers } from '../city/ui/CityPanel';
import type { CityLayersView } from '../city/useCityLayers';
import type { RadarView } from '../city/useRadar';
import { useCityT } from '../city/texts';
import { EventsPanel } from '../events/ui/EventsPanel';
import type { EventLayer } from '../events/useEvents';
import type { LiveCityView } from '../live/useLiveCity';
import { ageText } from '../model/card';
import { nearest } from '../model/vehicle';
import { useExploreT } from '../texts';
import { ModePanel } from './ModePanel';
import { Nearby } from './Nearby';

/** Modes that are places with a state, not vehicles: they are not counted as vehicles. */
const PLACES: ReadonlySet<LiveMode> = new Set([
  'airport',
  'bike-station',
  'rail-station',
  'micromobility',
]);

function Freshness({ live, now }: { live: LiveCityView; now: number }) {
  const t = useExploreT();
  if (live.receivedAt === null) {
    return live.failing ? (
      <p className="ex-fresh failing" role="status">
        {t.failed}{' '}
        <button type="button" className="ex-link" onClick={live.retryNow}>
          {t.retryNow}
        </button>
      </p>
    ) : (
      <p className="ex-fresh" role="status">
        {t.loading}
      </p>
    );
  }
  const age = ageText((now - live.receivedAt) / 1000);
  return (
    <p className={`ex-fresh${live.failing ? ' failing' : ''}`} role="status">
      {live.failing ? t.connectionLost(age) : t.updated(age)}
      {live.failing && (
        <>
          {' '}
          <button type="button" className="ex-link" onClick={live.retryNow}>
            {t.retryNow}
          </button>
        </>
      )}
    </p>
  );
}

/**
 * The panel: the count, the modes with their state, the events, the city layers and what is near.
 * The list of every source is the control room's (`#/ops`); each card cites its own.
 */
export function Overview(props: {
  live: LiveCityView;
  events: EventLayer;
  city: CityLayersView;
  radar: RadarView;
  box: BoundingBox;
  hidden: ReadonlySet<LiveMode>;
  onToggle: (mode: LiveMode) => void;
  center: readonly [number, number];
  vehicles: readonly LiveVehicle[];
  now: number;
  onOpen: (id: string) => void;
  destination: string | null;
}) {
  const t = useExploreT();
  const groups = useCityT().groups;
  const locale = useLocale();
  const { data } = props.live;
  const cityPanel = {
    city: props.city,
    radar: props.radar,
    box: props.box,
    now: props.now,
    onOpen: props.onOpen,
  };
  const shown = (data?.modes ?? [])
    .filter((mode) => !props.hidden.has(mode.mode) && !PLACES.has(mode.mode))
    .reduce((total, mode) => total + mode.shown, 0);
  return (
    <div className="ex-overview">
      <header className="ex-head">
        <p className="ex-eyebrow">{t.eyebrow}</p>
        {data !== null && (
          <h1>
            <span className="ex-big mono">{shown.toLocaleString(locale)}</span>
            <span className="ex-headline">{t.headline}</span>
          </h1>
        )}
        <Freshness live={props.live} now={props.now} />
      </header>
      {(data !== null || props.city.data !== null) && (
        <p className="ex-city-title ex-transport">{groups.transport}</p>
      )}
      {data !== null && (
        <ModePanel modes={data.modes} hidden={props.hidden} onToggle={props.onToggle} />
      )}
      <TransportLayers {...cityPanel} />
      <EventsPanel
        layer={props.events}
        onOpen={props.onOpen}
        tourist={props.destination === 'tourist'}
      />
      <CityPanel {...cityPanel} destination={props.destination} />
      {data !== null && (
        <Nearby
          vehicles={nearest(props.vehicles, props.center, 5)}
          now={props.now}
          onOpen={props.onOpen}
        />
      )}
    </div>
  );
}
