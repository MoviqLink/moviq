import type { Alternative, Journey } from '@moviq/contracts';
import { AttributionControl, Map as MapLibre, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { useLocale } from '../../../shared/i18n';
import { styleUrl, withoutClutter } from '../../../shared/map/base-style';
import { formatCityTime } from '../../../shared/time/city';
import { riskyLegs } from '../model/projection';
import { boundsOf, routeFeatures, stopsOf } from './geometry';
import { addRouteLayers, drawRouteOnce, setLine } from './layers';
import { placeStops } from './markers';
import { tuneBaseMap } from './style';

// MapLibre finds its worker next to its own module, which the bundler moves; this is the real file.
setWorkerUrl(workerUrl);

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  readonly journey: Journey;
  readonly alternative: Alternative | null;
  readonly dark: boolean;
  /** Desktop layout: panels on both sides and the timeline below. */
  readonly wide: boolean;
  readonly label: string;
  /** Said in place of the map when this browser cannot draw it. */
  readonly failedText: string;
}

/** Creates the map once per theme and layout, and says so if this browser cannot draw it. */
function useMapLibre(box: RefObject<HTMLDivElement | null>, dark: boolean, wide: boolean) {
  const [map, setMap] = useState<MapLibre | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    let instance: MapLibre;
    try {
      instance = new MapLibre({
        container,
        style: styleUrl(dark),
        transformStyle: withoutClutter,
        center: [-73.94, 40.78],
        zoom: 12,
        pitch: 50,
        bearing: -20,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      });
    } catch {
      queueMicrotask(() => {
        setFailed(true);
      });
      return;
    }
    instance.addControl(
      new AttributionControl({ compact: false }),
      wide ? 'bottom-right' : 'top-right',
    );
    if (wide) instance.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    instance.on('load', () => {
      tuneBaseMap(instance, dark);
      addRouteLayers(instance, dark);
      setMap(instance);
    });
    return () => {
      setMap(null);
      instance.remove();
    };
  }, [box, dark, wide]);
  return { map, failed };
}

/** The trip on a 3D map: the route drawn once, its stops, and the alternative being looked at. */
export function TripMap({ journey, alternative, dark, wide, label, failedText }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const { map, failed } = useMapLibre(box, dark, wide);
  const locale = useLocale();
  const drawn = useRef(false);
  const { itinerary, incidents } = journey;
  const hasSide = journey.alternatives.length > 0 || incidents.length > 0;

  useEffect(() => {
    if (map === null) return;
    const route = routeFeatures(itinerary, riskyLegs(incidents));
    if (drawn.current || reducedMotion()) {
      setLine(map, 'route', route);
      return;
    }
    drawn.current = true;
    return drawRouteOnce(map, route, 1600);
  }, [map, itinerary, incidents]);

  useEffect(() => {
    if (map === null) return;
    return placeStops(map, stopsOf(itinerary), (at) => formatCityTime(at, locale));
  }, [map, itinerary, locale]);

  useEffect(() => {
    if (map === null) return;
    setLine(map, 'alternative', alternative === null ? null : routeFeatures(alternative.itinerary));
    const bounds = boundsOf(
      alternative === null ? [itinerary] : [itinerary, alternative.itinerary],
    );
    if (bounds === null) return;
    const padding = wide
      ? { top: 100, bottom: 240, left: 430, right: hasSide ? 420 : 80 }
      : { top: 90, bottom: Math.round(window.innerHeight * 0.48), left: 40, right: 40 };
    map.fitBounds(bounds, {
      padding,
      pitch: 50,
      bearing: -20,
      maxZoom: 15.5,
      duration: reducedMotion() ? 0 : 900,
    });
  }, [map, itinerary, alternative, wide, hasSide]);

  return (
    <div className="trip-map" ref={box} role="region" aria-label={label}>
      {failed && <p className="trip-map-failed">{failedText}</p>}
    </div>
  );
}
