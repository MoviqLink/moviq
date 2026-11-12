import type { LiveVehicle } from '@moviq/contracts';
import type { Map as MapLibre } from 'maplibre-gl';
import { useEffect } from 'react';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Follow the latest reported GPS while the virtual ride remains live. */
export function useFollowVehicle(
  map: MapLibre | null,
  follow: LiveVehicle | null | undefined,
  wide: boolean,
) {
  const lat = follow?.position.lat;
  const lon = follow?.position.lon;
  useEffect(() => {
    if (map === null || lat === undefined || lon === undefined) return;
    map.easeTo({
      center: [lon, lat],
      zoom: Math.max(map.getZoom(), 14),
      padding: wide
        ? { top: 80, bottom: 40, left: 400, right: 40 }
        : { top: 70, bottom: Math.round(window.innerHeight * 0.52), left: 20, right: 20 },
      duration: reducedMotion() ? 0 : 800,
    });
  }, [map, lat, lon, wide]);
}
