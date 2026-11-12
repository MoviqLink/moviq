import type { Map as MapLibre } from 'maplibre-gl';

import { quietBaseMap } from '../../../shared/map/base-style';

export type MapView = '2d' | 'photo';

// USGS supplies a cached regional base; acquisition dates and resolution vary by area.
const AERIAL_BASE = {
  tiles: [
    'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
  ],
  maxzoom: 16,
  attribution: 'USGS The National Map · Imagery',
};
// The slower, detailed NYS 2024 photographs are requested only at street zoom.
const AERIAL_DETAIL = {
  tiles: ['https://orthos.its.ny.gov/arcgis/rest/services/wms/2024/MapServer/tile/{z}/{y}/{x}'],
  maxzoom: 19,
  bounds: [-74.26, 40.49, -73.69, 40.92] as [number, number, number, number],
};

const AERIAL = 'explore-aerial';
const DETAIL = 'explore-aerial-detail';

/**
 * Quiets the base map like a scale model and lays the aerial photo over the background, hidden
 * until it is chosen.
 */
export function tuneBaseMap(map: MapLibre, dark: boolean, photoCredit: string): void {
  quietBaseMap(map, dark);
  // Keep vector ground underneath while photographs arrive; labels stay above imagery.
  const overGround = map.getStyle().layers.find((layer) => layer.type === 'symbol')?.id;
  addImagery(map, AERIAL, AERIAL_BASE, 0, overGround);
  addImagery(map, DETAIL, { ...AERIAL_DETAIL, attribution: photoCredit }, 16, overGround);
}

/** Keep the regional photo underneath while finer photographs download. */
function addImagery(
  map: MapLibre,
  id: string,
  source: {
    tiles: string[];
    maxzoom: number;
    attribution: string;
    bounds?: [number, number, number, number];
  },
  minzoom: number,
  before?: string,
): void {
  map.addSource(id, { type: 'raster', tileSize: 256, ...source });
  map.addLayer(
    {
      id,
      type: 'raster',
      source: id,
      minzoom,
      layout: { visibility: 'none' },
      paint: { 'raster-fade-duration': 350, 'raster-resampling': 'linear' },
    },
    before,
  );
}

/** Change only visible layers; the user's camera remains unchanged. */
export function showView(
  map: {
    setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): unknown;
  },
  view: MapView,
): void {
  for (const layer of [AERIAL, DETAIL]) {
    map.setLayoutProperty(layer, 'visibility', view === 'photo' ? 'visible' : 'none');
  }
}
