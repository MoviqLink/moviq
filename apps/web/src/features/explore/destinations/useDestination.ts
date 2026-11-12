import type { LiveMode } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';
import type { CityLayersView } from '../city/useCityLayers';
import type { EventLayer } from '../events/useEvents';
import { layersToRestore } from './layer-restore';

/** Apply a destination once, then focus its control when live data arrives. */
export function useExploreDestination(
  viewTarget: string | null,
  hidden: ReadonlySet<LiveMode>,
  toggle: (mode: LiveMode) => void,
  close: () => void,
  city: CityLayersView,
  events: EventLayer,
) {
  const focusedTarget = useRef<string | null>(null);
  const previousTarget = useRef<string | null>(null);
  const savedNormal = useRef<{ layers: typeof city.on; events: boolean } | null>(null);
  useEffect(() => {
    close();
    if (previousTarget.current === null && viewTarget !== null) {
      savedNormal.current = { layers: new Set(city.on), events: events.on };
    }
    if (previousTarget.current !== null && viewTarget === null && savedNormal.current !== null) {
      for (const layer of layersToRestore(city.on, savedNormal.current.layers)) city.toggle(layer);
      if (events.on !== savedNormal.current.events) events.toggle();
      savedNormal.current = null;
    }
    previousTarget.current = viewTarget;
    if (viewTarget === 'virtual' && hidden.has('bus')) toggle('bus');
    if (viewTarget === 'stations' && !city.on.has('subway-entrances'))
      city.toggle('subway-entrances');
    if (viewTarget === 'incidents' && !city.on.has('incidents')) city.toggle('incidents');
    if (viewTarget === 'incidents' && !city.on.has('transit-alerts')) city.toggle('transit-alerts');
    if (viewTarget === 'traffic' && !city.on.has('cameras')) city.toggle('cameras');
    if (viewTarget === 'traffic' && !city.on.has('incidents')) city.toggle('incidents');
    if (viewTarget === 'traffic' && !city.on.has('closures')) city.toggle('closures');
    if (viewTarget === 'tourist' && !events.on) events.toggle();
    if (viewTarget === 'tourist' && !city.on.has('landmarks')) city.toggle('landmarks');
    // Applying a destination is a one-time navigation action, not a locked filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only navigation applies these choices.
  }, [viewTarget]);
  useEffect(() => {
    if (viewTarget === null) {
      focusedTarget.current = null;
      return;
    }
    // The focused panel has a stable position while its own data loads.
    const layout = viewTarget;
    if (focusedTarget.current === layout) return;
    const target = document.getElementById(`explore-${viewTarget}`);
    if (target instanceof HTMLElement) {
      target.focus();
      target.scrollIntoView({ block: 'start' });
      focusedTarget.current = layout;
    }
  }, [viewTarget]);
}

/** The tourist overlay starts with vehicles hidden on each entry, without changing mode filters. */
export function useTouristVehicles(destination: string | null) {
  const [choice, setChoice] = useState({ destination, show: false });
  if (choice.destination !== destination) setChoice({ destination, show: false });
  const show = choice.destination === destination && choice.show;
  return {
    show,
    toggle: () => {
      setChoice({ destination, show: !show });
    },
  };
}
