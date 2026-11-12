import type { Map as MapLibre, RasterTileSource } from 'maplibre-gl';

const RADAR_LAYER = 'explore-radar';

/**
 * NOAA's base reflectivity mosaic of the contiguous United States (`conus_bref_qcd`), from the
 * National Weather Service's GeoServer, as a WMS layer in Web Mercator: public domain, as every
 * work of the US government. The browser asks these tiles from NOAA, as it asks the base map.
 */
export const RADAR_TILES =
  'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?SERVICE=WMS&VERSION=1.3.0' +
  '&REQUEST=GetMap&LAYERS=conus_bref_qcd&STYLES=&FORMAT=image/png&TRANSPARENT=true' +
  '&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}';

const RADAR_ATTRIBUTION = 'Radar: NOAA National Weather Service (public domain)';

/**
 * Shows the radar over the base map and under every mark, or removes it. Each call while on asks
 * the tiles again; new tiles replace the old ones at once, with no fade.
 */
export function showRadar(map: MapLibre, on: boolean, below: string | undefined): void {
  const source = map.getSource<RasterTileSource>(RADAR_LAYER);
  if (!on) {
    if (map.getLayer(RADAR_LAYER) !== undefined) map.removeLayer(RADAR_LAYER);
    if (source !== undefined) map.removeSource(RADAR_LAYER);
    return;
  }
  if (source !== undefined) {
    source.setTiles([RADAR_TILES]);
    return;
  }
  map.addSource(RADAR_LAYER, {
    type: 'raster',
    tiles: [RADAR_TILES],
    tileSize: 256,
    attribution: RADAR_ATTRIBUTION,
  });
  map.addLayer(
    {
      id: RADAR_LAYER,
      type: 'raster',
      source: RADAR_LAYER,
      paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0 },
    },
    below,
  );
}
