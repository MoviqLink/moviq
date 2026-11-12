import { useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import type { LiveVehicle } from '@moviq/contracts';
import { TopBar } from '../../../shared/ui/TopBar';
import { useLang } from '../../../shared/i18n/lang';
import { RidePanel } from '../../virtual/RidePanel';
import { useVirtualT } from '../../virtual/texts';
import type { useVirtualRide } from '../../virtual/useVirtualRide';
import type { MapView } from '../map/basemap';
import { ExploreMap } from '../map/ExploreMap';
import { useSelectedRoute } from '../map/selected-route';
import { useExploreT } from '../texts';
import { LayerSwitch } from './LayerSwitch';
import { destinationOf } from '../destinations/DestinationPanel';
import '../vehicle-panel.css';

function MapControls({
  view,
  onView,
  tourist,
  show,
  onToggle,
}: {
  view: MapView;
  onView: (value: MapView) => void;
  tourist: boolean;
  show: boolean;
  onToggle: () => void;
}) {
  const t = useExploreT();
  return (
    <div className="ex-layers-dock">
      <LayerSwitch view={view} onChange={onView} />
      {tourist && (
        <div className="ex-tourist-vehicles">
          <button type="button" aria-pressed={show} onClick={onToggle}>
            {t.touristVehicles}
          </button>
          <span role="status">{show ? t.touristVehiclesShown : t.touristVehiclesHidden}</span>
        </div>
      )}
    </div>
  );
}

export function virtualCard(virtual: ReturnType<typeof useVirtualRide>, regularCard: ReactNode) {
  if (virtual.ride === null) return regularCard;
  return (
    <RidePanel
      key={virtual.ride.id}
      ride={virtual.ride}
      busy={virtual.busy}
      failed={virtual.failed}
      actions={{
        getOff: () => {
          void virtual.getOff();
        },
        refresh: virtual.refresh,
        replaceNeed: virtual.replaceNeed,
      }}
    />
  );
}

const NO_VEHICLES: readonly LiveVehicle[] = [];
const NO_STATIONS: ComponentProps<typeof ExploreMap>['stations'] = [];
const NO_EVENTS: ComponentProps<typeof ExploreMap>['events'] = [];

function useDestinationMap(
  mapProps: ComponentProps<typeof ExploreMap>,
  destination: ReturnType<typeof destinationOf>,
  show: boolean,
  followVehicle: LiveVehicle | undefined,
) {
  const hideVehicles = destination !== null && (destination !== 'tourist' || !show);
  const vehicles = useMemo(() => {
    if (hideVehicles) return followVehicle === undefined ? NO_VEHICLES : [followVehicle];
    return followVehicle === undefined
      ? mapProps.vehicles
      : [...mapProps.vehicles.filter((item) => item.id !== followVehicle.id), followVehicle];
  }, [hideVehicles, followVehicle, mapProps.vehicles]);
  const city = useMemo(() => {
    const layers =
      destination === 'stations'
        ? ['subway-entrances']
        : destination === 'incidents'
          ? ['incidents', 'transit-alerts']
          : destination === 'traffic'
            ? ['cameras', 'incidents', 'closures']
            : destination === 'tourist'
              ? ['landmarks']
              : null;
    return layers === null
      ? mapProps.city
      : mapProps.city.filter((item) => layers.includes(item.layer));
  }, [mapProps.city, destination]);
  const stations = useMemo(
    () =>
      destination === null
        ? mapProps.stations
        : destination === 'stations'
          ? mapProps.stations.filter(
              (station) => station.mode === 'rail-station' || station.mode === 'bike-station',
            )
          : NO_STATIONS,
    [mapProps.stations, destination],
  );
  const events = destination === null || destination === 'tourist' ? mapProps.events : NO_EVENTS;
  return { vehicles, city, stations, events };
}

function RouteNotice({
  routeStatus,
  routeCoverage,
  lang,
}: {
  routeStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  routeCoverage: 'full' | 'partial' | undefined;
  lang: 'en' | 'es';
}) {
  return routeStatus === 'unavailable' || routeStatus === 'error' ? (
    <p className="ex-route-notice" role="status">
      {routeStatus === 'unavailable'
        ? lang === 'es'
          ? 'Recorrido no disponible'
          : 'Route unavailable'
        : lang === 'es'
          ? 'No se pudo cargar el recorrido'
          : 'Could not load the route'}
    </p>
  ) : routeCoverage === 'partial' && routeStatus === 'ready' ? (
    <p className="ex-route-notice" role="status">
      {lang === 'es'
        ? 'Tramo del recorrido · según las estaciones anunciadas'
        : 'Route segment · based on announced stops'}
    </p>
  ) : null;
}

function MapPanel({
  wide,
  destination,
  card,
  overview,
  routeStatus,
  routeCoverage,
}: {
  wide: boolean;
  destination: boolean;
  card: ReactNode;
  overview: ReactNode;
  routeStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  routeCoverage: 'full' | 'partial' | undefined;
}) {
  const lang = useLang();
  const [expanded, setExpanded] = useState(false);
  const panelClass = [
    'ex-panel',
    destination && 'ex-panel-destination',
    card !== null && 'ex-panel-detail',
  ]
    .filter(Boolean)
    .join(' ');
  const sheetClass = [
    'ex-sheet',
    destination && 'ex-sheet-destination',
    card !== null && 'ex-sheet-detail',
    expanded && 'ex-sheet-expanded',
  ]
    .filter(Boolean)
    .join(' ');
  const notice = (
    <RouteNotice routeStatus={routeStatus} routeCoverage={routeCoverage} lang={lang} />
  );
  return wide ? (
    <aside className={panelClass}>
      {notice}
      {card ?? overview}
    </aside>
  ) : (
    <aside className={sheetClass}>
      <button
        type="button"
        className="ex-sheet-handle"
        aria-expanded={expanded}
        aria-label={
          lang === 'es'
            ? expanded
              ? 'Reducir panel'
              : 'Ampliar panel'
            : expanded
              ? 'Reduce panel'
              : 'Expand panel'
        }
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        <span aria-hidden="true" />
      </button>
      {notice}
      {card ?? overview}
    </aside>
  );
}

function useMapRoute(vehicles: readonly LiveVehicle[], selected: string | null) {
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selected);
  const routeId =
    selectedVehicle !== undefined &&
    (selectedVehicle.mode === 'bus' ||
      selectedVehicle.mode === 'subway' ||
      selectedVehicle.mode === 'rail' ||
      selectedVehicle.mode === 'ferry' ||
      selectedVehicle.mode === 'shuttle')
      ? selectedVehicle.id
      : null;
  const routeKey = JSON.stringify([
    selectedVehicle?.line?.id ?? null,
    selectedVehicle?.tripId ?? null,
  ]);
  const route = useSelectedRoute(routeId, routeKey);
  return route;
}

export function ExploreStage({
  overview,
  card,
  viewTarget,
  virtual,
  touristVehicles,
  view,
  setView,
  selectedId,
  mapProps,
}: {
  overview: ReactNode;
  card: ReactNode;
  viewTarget: string | null;
  virtual: ReturnType<typeof useVirtualRide>;
  touristVehicles: { show: boolean; toggle: () => void };
  view: MapView;
  setView: (view: MapView) => void;
  selectedId: string | null;
  mapProps: ComponentProps<typeof ExploreMap>;
}) {
  const t = useExploreT();
  const vt = useVirtualT();
  const destination = destinationOf(viewTarget);
  const { vehicles, city, stations, events } = useDestinationMap(
    mapProps,
    destination,
    touristVehicles.show,
    destination === null ? virtual.ride?.vehicle : undefined,
  );
  const route = useMapRoute(vehicles, mapProps.selected);
  return (
    <>
      <TopBar variant="floating" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" className="explore" tabIndex={-1}>
        {viewTarget === 'virtual' && virtual.ride === null && (
          <p className="virtual-hint" role="status">
            {virtual.loading ? vt.loading : virtual.failed ? vt.connection : vt.hint}
          </p>
        )}
        <ExploreMap
          {...mapProps}
          selectedRoute={route.points}
          vehicles={vehicles}
          city={city}
          stations={stations}
          events={events}
        />
        <MapControls
          view={view}
          onView={setView}
          tourist={viewTarget === 'tourist'}
          show={touristVehicles.show}
          onToggle={touristVehicles.toggle}
        />
        <MapPanel
          key={virtual.ride?.id ?? selectedId ?? 'overview'}
          routeStatus={route.status}
          routeCoverage={route.coverage}
          wide={mapProps.wide}
          destination={destination !== null}
          card={card}
          overview={overview}
        />
      </main>
    </>
  );
}
