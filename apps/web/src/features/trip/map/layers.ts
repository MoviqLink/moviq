import type { FilterSpecification, GeoJSONSource, Map as MapLibre } from 'maplibre-gl';

import { routeColors } from './style';
import { trimRoute, type RouteCollection } from './geometry';

const EMPTY: RouteCollection = { type: 'FeatureCollection', features: [] };

/** The trip's route and the chosen alternative, each a line with a casing under it. */
export function addRouteLayers(map: MapLibre, dark: boolean): void {
  const c = routeColors(dark);
  const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
  for (const id of ['route', 'alternative']) map.addSource(id, { type: 'geojson', data: EMPTY });
  // Walks have no casing: a dotted line for an estimate, a thin solid one along the streets.
  const notWalk: FilterSpecification = [
    '!',
    ['in', ['get', 'kind'], ['literal', ['walk', 'street-walk']]],
  ];
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    filter: notWalk,
    layout: round,
    paint: { 'line-color': c.casing, 'line-width': 10 },
  });
  map.addLayer({
    id: 'route-walk',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'kind'], 'walk'],
    layout: round,
    paint: { 'line-color': c.walk, 'line-width': 3.5, 'line-dasharray': [0.6, 1.8] },
  });
  map.addLayer({
    id: 'route-street-walk',
    type: 'line',
    source: 'route',
    filter: ['==', ['get', 'kind'], 'street-walk'],
    layout: round,
    paint: { 'line-color': c.walk, 'line-width': 3.5 },
  });
  map.addLayer({
    id: 'route-ride',
    type: 'line',
    source: 'route',
    filter: notWalk,
    layout: round,
    paint: {
      'line-color': [
        'case',
        ['get', 'risk'],
        c.risk,
        ['==', ['get', 'kind'], 'taxi'],
        c.taxi,
        c.ride,
      ],
      'line-width': 5.5,
    },
  });
  map.addLayer({
    id: 'alternative-casing',
    type: 'line',
    source: 'alternative',
    layout: round,
    paint: { 'line-color': c.casing, 'line-width': 9 },
  });
  map.addLayer({
    id: 'alternative-line',
    type: 'line',
    source: 'alternative',
    layout: round,
    paint: { 'line-color': c.taxi, 'line-width': 5 },
  });
}

function sourceOf(map: MapLibre, id: 'route' | 'alternative'): GeoJSONSource | undefined {
  return map.getSource<GeoJSONSource>(id);
}

export function setLine(map: MapLibre, id: 'route' | 'alternative', data: RouteCollection | null) {
  void sourceOf(map, id)?.setData(data ?? EMPTY);
}

/** Draws the route once from the start to the arrival; returns what stops the drawing. */
export function drawRouteOnce(map: MapLibre, route: RouteCollection, ms: number): () => void {
  const started = performance.now();
  let frame = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / ms);
    setLine(map, 'route', trimRoute(route, 1 - (1 - t) ** 3));
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
  };
}
