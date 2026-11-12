import {
  setWorkerUrl,
  type LayerSpecification,
  type Map as MapLibre,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// Bundle the worker and its imports; MapLibre's relative default is not a Vite build asset.
setWorkerUrl(workerUrl);

/** OpenFreeMap's free vector styles: Positron by day, its dark pair by night. */
export const styleUrl = (dark: boolean): string =>
  `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;

/** The quiet ground of every MovIQ map; labels keep a contrast of at least 4.5:1 on it. */
const PALETTE = {
  light: {
    background: '#f1f2ef',
    water: '#d5e1e8',
    green: '#e6ece2',
    label: '#5f6870',
    halo: '#f6f7f5',
    building: '#e1e4e8',
  },
  dark: {
    background: '#0f1418',
    water: '#132029',
    green: '#121c17',
    label: '#8e99a3',
    halo: '#0f1418',
    building: '#1c242c',
  },
} as const;

/** Points of interest, road shields, house numbers, cable cars, ferry lines and one-way arrows. */
const CLUTTER = /poi|shield|housenumber|aerialway|ferry|oneway/;

/**
 * A label that writes a road's reference (`I 95;NJTP`, `HH;NY 9A`) instead of a name: codes from
 * the map data that no traveller reads, which the names of streets and places do not need.
 */
function writesRoadRef(layer: LayerSpecification): boolean {
  if (layer.type !== 'symbol') return false;
  const text = JSON.stringify(layer.layout?.['text-field'] ?? '');
  return /\["get","ref"\]|\{ref\}/.test(text);
}

/** The smallest label written, in pixels: Dark writes its streets and places at 10. */
const SMALLEST_LABEL = 11;

/** A label of a fixed size, written no smaller than `SMALLEST_LABEL`. */
function readable(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol') return layer;
  const size = layer.layout?.['text-size'];
  if (typeof size !== 'number' || size >= SMALLEST_LABEL) return layer;
  return { ...layer, layout: { ...layer.layout, 'text-size': SMALLEST_LABEL } };
}

/** A fill drawn in its plain colour: the textures some styles ask for are not in their sprites. */
function plain(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'fill' || layer.paint?.['fill-pattern'] === undefined) return layer;
  const { 'fill-pattern': _pattern, ...paint } = layer.paint;
  return { ...layer, paint };
}

/**
 * The base style before it is drawn, as MapLibre's `transformStyle`: without clutter and without
 * road references, so only the names of streets, neighbourhoods and places are written, at a
 * size that can be read.
 */
export function withoutClutter(_previous: unknown, next: StyleSpecification): StyleSpecification {
  const kept = next.layers.filter((layer) => !CLUTTER.test(layer.id) && !writesRoadRef(layer));
  return { ...next, layers: kept.map(plain).map(readable) };
}

/** Repaints the ground, water, parks and labels of the base map in MovIQ's quiet colours. */
export function quietBaseMap(map: MapLibre, dark: boolean): void {
  const colours = dark ? PALETTE.dark : PALETTE.light;
  for (const layer of map.getStyle().layers) {
    const { id } = layer;
    if (layer.type === 'background') {
      map.setPaintProperty(id, 'background-color', colours.background);
    }
    if (layer.type === 'fill' && id.includes('water')) {
      map.setPaintProperty(id, 'fill-color', colours.water);
    }
    if (layer.type === 'fill' && /park|wood|landcover|grass/.test(id)) {
      map.setPaintProperty(id, 'fill-color', colours.green);
    }
    if (layer.type === 'symbol') {
      map.setPaintProperty(id, 'text-color', colours.label);
      map.setPaintProperty(id, 'text-halo-color', colours.halo);
    }
  }
}

/** Raises the buildings of the base map's vector source under its labels, from zoom 12. */
export function addBuildings(map: MapLibre, id: string, dark: boolean): void {
  const style = map.getStyle();
  const source = Object.keys(style.sources).find((key) => style.sources[key]?.type === 'vector');
  if (source === undefined) return;
  const firstSymbol = style.layers.find((layer) => layer.type === 'symbol')?.id;
  map.addLayer(
    {
      id,
      type: 'fill-extrusion',
      source,
      'source-layer': 'building',
      minzoom: 12,
      paint: {
        'fill-extrusion-color': (dark ? PALETTE.dark : PALETTE.light).building,
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 12],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      },
    },
    firstSymbol,
  );
}
