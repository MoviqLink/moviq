import { liveVehicleRouteSchema } from '@moviq/contracts';
import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import type { LngLat } from './motion';
import { startRoutePolling } from './route-poller';

const SOURCE = 'explore-selected-route';
export function addSelectedRoute(map: MapLibre): void {
  map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  for (const [id, colour, width] of [
    ['casing', '#ffffff', 7],
    ['line', '#147bcb', 4],
  ] as const) {
    map.addLayer({
      id: `${SOURCE}-${id}`,
      type: 'line',
      source: SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colour, 'line-width': width, 'line-opacity': 0.9 },
    });
  }
}

/** Fetch only the selected vehicle's own GTFS shape; discard stale or failed requests. */
export function useSelectedRoute(
  id: string | null,
  lineId: string | null,
): {
  points: readonly LngLat[] | null;
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  coverage?: 'full' | 'partial';
} {
  const [result, setResult] = useState<{
    id: string;
    lineId: string | null;
    points: readonly LngLat[] | null;
    status: 'ready' | 'unavailable' | 'error';
    coverage?: 'full' | 'partial';
  } | null>(null);
  useEffect(() => {
    if (id === null) return;
    return startRoutePolling(async (signal) => {
      try {
        const answer = await api.json(
          `/api/live/route?vehicle=${encodeURIComponent(id)}`,
          liveVehicleRouteSchema,
          { signal },
        );
        if (!signal.aborted)
          setResult({
            id,
            lineId,
            points: answer.coordinates,
            status: answer.coordinates === null ? 'unavailable' : 'ready',
            ...(answer.coverage === undefined ? {} : { coverage: answer.coverage }),
          });
      } catch {
        if (!signal.aborted) setResult({ id, lineId, points: null, status: 'error' });
      }
    });
  }, [id, lineId]);
  if (id === null) return { points: null, status: 'idle' };
  if (result?.id !== id || result.lineId !== lineId) return { points: null, status: 'loading' };
  return {
    points: result.points,
    status: result.status,
    ...(result.coverage === undefined ? {} : { coverage: result.coverage }),
  };
}

export function useDrawSelectedRoute(map: MapLibre | null, route: readonly LngLat[] | null): void {
  useEffect(() => {
    void map?.getSource<GeoJSONSource>(SOURCE)?.setData({
      type: 'FeatureCollection',
      features:
        route === null
          ? []
          : [
              {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: route.map((point) => [...point]) },
              },
            ],
    });
  }, [map, route]);
}
