import type { BoundingBox, LiveMode } from '@moviq/contracts';
import { useCallback, useEffect, useState } from 'react';
import { useVirtualRide } from '../../virtual/useVirtualRide';
import { useHashSegments } from '../../../shared/routing/hash';
import { useDarkTheme } from '../../../shared/theme/useDarkTheme';
import { useNow } from '../../../shared/time/clock';
import { useMediaQuery } from '../../../shared/ui/useMediaQuery';
import { useCityLayers } from '../city/useCityLayers';
import { useRadar } from '../city/useRadar';
import { useExploreDestination, useTouristVehicles } from '../destinations/useDestination';
import { useEventsOnMap } from '../events/useEvents';
import type { MapView } from '../map/basemap';
import { FIRST_HIDDEN } from '../model/shown';
import { useExploreT } from '../texts';
import { useLineCatalog } from './useLineCatalog';
import { useLineSelection } from './useLineSelection';
import { useShownCity } from './useShownCity';

/** The five boroughs: read before the map reports its own box, and if it cannot draw at all. */
const CITY: BoundingBox = [-74.26, 40.49, -73.69, 40.92];

/** Station discovery uses its own modes and leaves the map's filters untouched. */
const STATION_HIDDEN: ReadonlySet<LiveMode> = new Set([
  'micromobility',
  'aircraft',
  'ship',
  'airport',
  'ferry',
  'shuttle',
]);

/** What the visitor chose: the box in view, the map view, the hidden modes and the selection. */
function useExploreChoices() {
  const [box, setBox] = useState<BoundingBox>(CITY);
  const [view, setView] = useState<MapView>('2d');
  const [hidden, setHidden] = useState<ReadonlySet<LiveMode>>(FIRST_HIDDEN);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const close = useCallback(() => {
    setSelectedId(null);
  }, []);
  const toggle = useCallback((mode: LiveMode) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });
  }, []);
  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [selectedId]);
  return { box, setBox, view, setView, hidden, toggle, selectedId, setSelectedId, close };
}

export function useExploreData() {
  const t = useExploreT();
  useHashSegments();
  const viewTarget = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('view');
  const touristVehicles = useTouristVehicles(viewTarget);
  const normalMap = viewTarget === null;
  const choice = useLineSelection();
  const catalog = useLineCatalog(normalMap);
  const [rideEngaged, setRideEngaged] = useState(false);
  const virtualActive = viewTarget === 'virtual' || rideEngaged;
  const virtual = useVirtualRide(virtualActive);
  const dark = useDarkTheme();
  const wide = useMediaQuery('(min-width: 1024px)');
  const now = useNow();
  const { box, setBox, view, setView, hidden, toggle, selectedId, setSelectedId, close } =
    useExploreChoices();
  const { live, selection, vehicles, stations } = useShownCity(
    box,
    viewTarget === 'stations' ? STATION_HIDDEN : hidden,
    selectedId,
    normalMap ? choice : null,
  );
  const { layer: eventLayer, events, selected: event } = useEventsOnMap(selectedId);
  const city = useCityLayers(box);
  const radar = useRadar();
  useExploreDestination(viewTarget, hidden, toggle, close, city, eventLayer);
  return {
    t,
    viewTarget,
    touristVehicles,
    normalMap,
    choice,
    catalog,
    virtual,
    virtualActive,
    setRideEngaged,
    dark,
    wide,
    now,
    box,
    setBox,
    view,
    setView,
    hidden,
    toggle,
    selectedId,
    setSelectedId,
    close,
    live,
    selection,
    vehicles,
    stations,
    eventLayer,
    events,
    event,
    city,
    radar,
  };
}
