import type { CityItem } from '@moviq/contracts';
import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';

import { toneOf } from '../city/model/layers';

export const CITY_POINTS = 'explore-city-points';
export const CITY_LINES = 'explore-city-lines';

/** Red for what is closed, amber for a risk, ink for places, grey for the quiet facts. */
const coloursOf = (dark: boolean) =>
  dark
    ? { closed: '#ff7b70', risk: '#f2b257', place: '#e6eaee', quiet: '#8d99a3', paper: '#12181e' }
    : { closed: '#d9473b', risk: '#e58a00', place: '#0e1318', quiet: '#7f8b95', paper: '#ffffff' };

const isSelected: ExpressionSpecification = ['==', ['get', 'selected'], 1];

const toneColour = (dark: boolean): ExpressionSpecification => {
  const colours = coloursOf(dark);
  return [
    'match',
    ['get', 'tone'],
    'closed',
    colours.closed,
    'risk',
    colours.risk,
    'place',
    colours.place,
    colours.quiet,
  ];
};

/** Below the live marks and the events: the city is the setting, the vehicles move over it. */
const beneath = (map: MapLibre) =>
  ['explore-parked', 'explore-stations', 'explore-vehicles'].find(
    (id) => map.getLayer(id) !== undefined,
  );

/** The streets and roads a layer covers, as lines, and every placed item as a dot over them. */
export function addCityLayers(map: MapLibre, dark: boolean): void {
  const colours = coloursOf(dark);
  const empty = { type: 'FeatureCollection' as const, features: [] };
  map.addSource(CITY_LINES, { type: 'geojson', data: empty });
  map.addSource(CITY_POINTS, { type: 'geojson', data: empty });
  const before = beneath(map);
  map.addLayer(
    {
      id: CITY_LINES,
      type: 'line',
      source: CITY_LINES,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': toneColour(dark),
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, ['case', isSelected, 7, 5]],
        'line-opacity': 0.85,
      },
    },
    before,
  );
  map.addLayer(
    {
      id: CITY_POINTS,
      type: 'circle',
      source: CITY_POINTS,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          ['case', isSelected, 6, ['==', ['get', 'dense'], 1], 2.5, 4],
          15,
          ['case', isSelected, 10, ['==', ['get', 'dense'], 1], 5, 7],
        ],
        'circle-color': toneColour(dark),
        'circle-stroke-width': ['case', isSelected, 3, 1.5],
        'circle-stroke-color': colours.paper,
      },
    },
    before,
  );
}

interface Feature<G> {
  type: 'Feature';
  geometry: G;
  properties: { id: string; tone: string; dense: 0 | 1; selected: 0 | 1 };
}

/** Layers of many items a street apart: drawn smaller, so the street stays readable. */
const DENSE: ReadonlySet<CityItem['layer']> = new Set([
  'chargers',
  'defibrillators',
  'restrooms',
  'landmarks',
  'subway-entrances',
  'parking-meters',
  'parking-signs',
]);

const propsOf = (item: CityItem, selected: string | null) => ({
  id: item.id,
  tone: toneOf(item.layer),
  dense: DENSE.has(item.layer) ? (1 as const) : (0 as const),
  selected: item.id === selected ? (1 as const) : (0 as const),
});

/** The placed items as GeoJSON points. */
export function cityPointFeatures(items: readonly CityItem[], selected: string | null) {
  const features: Feature<{ type: 'Point'; coordinates: [number, number] }>[] = items.flatMap(
    (item) =>
      item.point === null
        ? []
        : [
            {
              type: 'Feature' as const,
              geometry: { type: 'Point' as const, coordinates: item.point },
              properties: propsOf(item, selected),
            },
          ],
  );
  return { type: 'FeatureCollection' as const, features };
}

/** The lines of the items that cover a street or a road. */
export function cityLineFeatures(items: readonly CityItem[], selected: string | null) {
  const features: Feature<{ type: 'MultiLineString'; coordinates: [number, number][][] }>[] =
    items.flatMap((item) =>
      item.lines.length === 0
        ? []
        : [
            {
              type: 'Feature' as const,
              geometry: { type: 'MultiLineString' as const, coordinates: item.lines },
              properties: propsOf(item, selected),
            },
          ],
    );
  return { type: 'FeatureCollection' as const, features };
}
