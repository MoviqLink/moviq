import type { BoundingBox, CityItem, LiveStation, LiveVehicle, MovIqEvent } from '@moviq/contracts';
import {
  AttributionControl,
  Map as MapLibre,
  NavigationControl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { styleUrl, withoutClutter } from '../../../shared/map/base-style';
import { showView, tuneBaseMap, type MapView } from './basemap';
import { needsNewBounds } from './bounds';
import { createMapDiagnostics } from './diagnostics';
import {
  addCityLayers,
  CITY_LINES,
  CITY_POINTS,
  cityLineFeatures,
  cityPointFeatures,
} from './city-layer';
import { addEventLayer, eventFeatures, EVENTS_LAYER } from './events-layer';
import { addLiveLayers, CLICKABLE } from './layers';
import { MapNotice } from './MapNotice';
import { stationFeatures } from './marks';
import { useMovingMarks } from './useMovingMarks';
import { showRadar } from './radar-layer';
import { useDrawSelectedRoute } from './selected-route';
import type { LngLat } from './motion';
import { useFollowVehicle } from './follow-vehicle';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  readonly vehicles: readonly LiveVehicle[];
  readonly follow?: LiveVehicle | null;
  readonly stations: readonly LiveStation[];
  readonly events: readonly MovIqEvent[];
  /** The placed items of the city layers on. */
  readonly city: readonly CityItem[];
  /** When the radar was last asked; null while it is off. */
  readonly radarAskedAt: number | null;
  readonly selected: string | null;
  readonly selectedRoute?: readonly LngLat[] | null;
  readonly view: MapView;
  readonly dark: boolean;
  readonly wide: boolean;
  readonly label: string;
  readonly failedText: string;
  readonly photoCredit: string;
  readonly onSelect: (id: string) => void;
  readonly onBounds: (box: BoundingBox) => void;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Everything that opens a card when clicked, the city last so a vehicle on top wins. */
const PICKABLE = [...CLICKABLE, EVENTS_LAYER, CITY_POINTS, CITY_LINES];

/** The visible box, a quarter larger on each side so marks just outside are already there. */
function paddedBounds(map: MapLibre): BoundingBox {
  const bounds = map.getBounds();
  const dx = (bounds.getEast() - bounds.getWest()) / 4;
  const dy = (bounds.getNorth() - bounds.getSouth()) / 4;
  return [
    round(Math.max(-180, bounds.getWest() - dx)),
    round(Math.max(-90, bounds.getSouth() - dy)),
    round(Math.min(180, bounds.getEast() + dx)),
    round(Math.min(90, bounds.getNorth() + dy)),
  ];
}

function createMap(container: HTMLDivElement, dark: boolean, wide: boolean): MapLibre {
  return new MapLibre({
    container,
    style: styleUrl(dark),
    transformStyle: withoutClutter,
    center: [-73.985, 40.748],
    zoom: wide ? 13.4 : 12.6,
    pitch: 0,
    maxPitch: 0,
    bearing: 0,
    attributionControl: false,
    // Basemap URLs are versioned and the aerial flight is static. NOAA has its own refresh.
    refreshExpiredTiles: false,
    canvasContextAttributes: { antialias: true },
  });
}

/** Creates the map once per theme and layout, and says so if this browser cannot draw it. */
function useExploreMap(
  box: RefObject<HTMLDivElement | null>,
  dark: boolean,
  wide: boolean,
  photoCredit: string,
  attempt: number,
) {
  const [map, setMap] = useState<MapLibre | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const container = box.current;
    if (container === null) return;
    const reportFailure = createMapDiagnostics();
    let instance: MapLibre;
    queueMicrotask(() => {
      setFailed(false);
    });
    try {
      instance = createMap(container, dark, wide);
    } catch (error: unknown) {
      reportFailure('initialization', error);
      queueMicrotask(() => {
        setFailed(true);
      });
      return;
    }
    let ready = false;
    instance.on('error', (event) => {
      reportFailure('resource', event.error);
      if (!ready) setFailed(true);
    });
    instance.on('webglcontextlost', () => {
      reportFailure('context-lost', 'The browser lost the graphics context.');
      setFailed(true);
    });
    instance.addControl(new AttributionControl({ compact: !wide }), 'bottom-right');
    if (wide) instance.addControl(new NavigationControl(), 'bottom-right');
    const loadingTimeout = window.setTimeout(() => {
      reportFailure('timeout', 'Map initialization did not finish within 20 seconds.');
      setFailed(true);
    }, 20_000);
    instance.on('load', () => {
      window.clearTimeout(loadingTimeout);
      ready = true;
      setFailed(false);
      try {
        tuneBaseMap(instance, dark, photoCredit);
        addLiveLayers(instance, dark);
        addEventLayer(instance, dark);
        addCityLayers(instance, dark);
        setMap(instance);
      } catch (error: unknown) {
        reportFailure('initialization', error);
        setFailed(true);
      }
    });
    return () => {
      window.clearTimeout(loadingTimeout);
      setMap(null);
      instance.remove();
    };
  }, [box, dark, wide, photoCredit, attempt]);
  return { map, failed };
}

/** Reports the box after every move and opens what is clicked. */
function useMapEvents(
  map: MapLibre | null,
  onSelect: (id: string) => void,
  onBounds: (box: BoundingBox) => void,
): void {
  const callbacks = useRef({ onSelect, onBounds });
  useEffect(() => {
    callbacks.current = { onSelect, onBounds };
  }, [onSelect, onBounds]);
  useEffect(() => {
    if (map === null) return;
    let requested: BoundingBox | null = null;
    let settling = 0;
    const report = () => {
      const visible = map.getBounds();
      const bounds: BoundingBox = [
        visible.getWest(),
        visible.getSouth(),
        visible.getEast(),
        visible.getNorth(),
      ];
      if (!needsNewBounds(requested, bounds)) return;
      requested = paddedBounds(map);
      callbacks.current.onBounds(requested);
    };
    const settled = () => {
      window.clearTimeout(settling);
      settling = window.setTimeout(report, 200);
    };
    const pick = (event: MapLayerMouseEvent) => {
      const id: unknown = event.features?.[0]?.properties['id'];
      if (typeof id === 'string') callbacks.current.onSelect(id);
    };
    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const plain = () => {
      map.getCanvas().style.cursor = '';
    };
    report();
    map.on('moveend', settled);
    for (const layer of PICKABLE) {
      map.on('click', layer, pick);
      map.on('mouseenter', layer, pointer);
      map.on('mouseleave', layer, plain);
    }
    return () => {
      window.clearTimeout(settling);
      map.off('moveend', settled);
      for (const layer of PICKABLE) {
        map.off('click', layer, pick);
        map.off('mouseenter', layer, pointer);
        map.off('mouseleave', layer, plain);
      }
    };
  }, [map]);
}

function useFocus(
  map: MapLibre | null,
  selected: string | null,
  vehicles: readonly LiveVehicle[],
  stations: readonly LiveStation[],
  events: readonly MovIqEvent[],
  city: readonly CityItem[],
  wide: boolean,
): void {
  const items = useRef({ vehicles, stations, events, city });
  useEffect(() => {
    items.current = { vehicles, stations, events, city };
  }, [vehicles, stations, events, city]);
  useEffect(() => {
    if (map === null || selected === null) return;
    const vehicle = items.current.vehicles.find((candidate) => candidate.id === selected);
    const place =
      items.current.stations.find((candidate) => candidate.id === selected) ??
      items.current.events.find((candidate) => candidate.id === selected)?.venue;
    const cityPoint = items.current.city.find((candidate) => candidate.id === selected)?.point;
    const center: [number, number] | undefined =
      vehicle !== undefined
        ? [vehicle.position.lon, vehicle.position.lat]
        : place === undefined
          ? (cityPoint ?? undefined)
          : [place.lon, place.lat];
    if (center === undefined) return;
    map.easeTo({
      center,
      zoom: Math.max(map.getZoom(), 14),
      padding: wide
        ? { top: 80, bottom: 40, left: 400, right: 40 }
        : { top: 70, bottom: Math.round(window.innerHeight * 0.52), left: 20, right: 20 },
      duration: reducedMotion() ? 0 : 800,
    });
  }, [map, selected, wide]);
}

/**
 * Every vehicle that can be followed, each pointing along its course. Between two answers each
 * mark glides from its previous reading to its latest one, never past it.
 */
export function ExploreMap(props: Props) {
  const { vehicles, stations, events, city, selected, view, dark, wide } = props;
  const box = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const { map, failed } = useExploreMap(box, dark, wide, props.photoCredit, attempt);
  useEffect(() => {
    if (map === null) return;
    showView(map, view);
  }, [map, view]);
  useMapEvents(map, props.onSelect, props.onBounds);
  useFocus(map, selected, vehicles, stations, events, city, wide);
  useFollowVehicle(map, props.follow, wide);
  const route = props.selectedRoute ?? null;
  useMovingMarks(map, vehicles, selected, route);

  useDrawSelectedRoute(map, route);

  useEffect(() => {
    void map
      ?.getSource<GeoJSONSource>('explore-stations')
      ?.setData(stationFeatures(stations, selected));
  }, [map, stations, selected]);

  useEffect(() => {
    void map?.getSource<GeoJSONSource>(EVENTS_LAYER)?.setData(eventFeatures(events, selected));
  }, [map, events, selected]);

  useEffect(() => {
    void map?.getSource<GeoJSONSource>(CITY_POINTS)?.setData(cityPointFeatures(city, selected));
    void map?.getSource<GeoJSONSource>(CITY_LINES)?.setData(cityLineFeatures(city, selected));
  }, [map, city, selected]);

  useEffect(() => {
    if (map !== null) showRadar(map, props.radarAskedAt !== null, CITY_LINES);
  }, [map, props.radarAskedAt]);

  return (
    <div
      className="explore-map"
      ref={box}
      role="region"
      aria-label={props.label}
      data-map-status={failed ? 'failed' : map !== null ? 'ready' : 'loading'}
    >
      {(failed || map === null) && (
        <MapNotice
          failed={failed}
          failedText={props.failedText}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
