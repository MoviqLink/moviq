import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';

import { addMarkImages, modeColours } from './marks';
import { addSelectedRoute } from './selected-route';
import { addTrails } from './trails';

const isSelected: ExpressionSpecification = ['==', ['get', 'selected'], 1];
const ofMode = (mode: string): ExpressionSpecification => ['==', ['get', 'mode'], mode];

type Value = ExpressionSpecification | number;

/** The radius of a place in the city, near the street and at it, a little larger when selected. */
const radius = (city: Value, near: Value, street: Value) =>
  [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['+', city, ['case', isSelected, 2, 0]],
    13.5,
    ['+', near, ['case', isSelected, 2, 0]],
    15,
    ['+', street, ['case', isSelected, 2, 0]],
  ] satisfies ExpressionSpecification;

/** Below this zoom a bike station is a plain dot; from it on, a ring that carries its count. */
const RING_ZOOM = 13.5;

/** Bike stations small in the city view; PATH stations and airports always readable. */
const byPlace = (bike: number, path: number, airport: number): ExpressionSpecification => [
  'match',
  ['get', 'mode'],
  'bike-station',
  bike,
  'rail-station',
  path,
  airport,
];

/** Parked scooters and bikes: small dots that grow towards the street, under everything else. */
function addParked(map: MapLibre, dark: boolean): void {
  map.addLayer({
    id: 'explore-parked',
    type: 'circle',
    source: 'explore-stations',
    filter: ofMode('micromobility'),
    paint: {
      'circle-radius': radius(1.5, 3, 4.5),
      'circle-color': modeColours(dark).micromobility,
      'circle-stroke-width': ['case', isSelected, 2, 0.5],
      'circle-stroke-color': dark ? '#0c1014' : '#ffffff',
    },
  });
}

/** Bike stations, PATH stations and airports: a ring in the colour of their mode. */
function addPlaces(map: MapLibre, dark: boolean): void {
  const colours = modeColours(dark);
  const paper = dark ? '#12181e' : '#ffffff';
  map.addLayer({
    id: 'explore-stations',
    type: 'circle',
    source: 'explore-stations',
    filter: ['!', ofMode('micromobility')],
    paint: {
      'circle-radius': radius(byPlace(1.5, 6, 11), byPlace(6, 8, 11), byPlace(9, 10, 11)),
      // A PATH station is filled, as a stop on a line; the others are rings that carry a label.
      // In the city view the thousands of bike stations are small dots, so the map stays legible.
      'circle-color': [
        'step',
        ['zoom'],
        [
          'case',
          ofMode('rail-station'),
          colours['rail-station'],
          ofMode('bike-station'),
          colours['bike-station'],
          paper,
        ],
        RING_ZOOM,
        ['case', ofMode('rail-station'), colours['rail-station'], paper],
      ],
      'circle-stroke-width': [
        'step',
        ['zoom'],
        ['case', ofMode('bike-station'), 0, 2],
        RING_ZOOM,
        2,
      ],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'alert'], 1],
        '#e58a00',
        ofMode('rail-station'),
        paper,
        ofMode('bike-station'),
        colours['bike-station'],
        colours.airport,
      ],
    },
  });
  const label = (mode: 'airport' | 'bike-station', minzoom: number) => {
    map.addLayer({
      id: `explore-labels-${mode}`,
      type: 'symbol',
      source: 'explore-stations',
      minzoom,
      filter: ofMode(mode),
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 9,
        'text-font': ['Noto Sans Bold'],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': colours[mode] },
    });
  };
  label('airport', 0);
  // Bike counts only near the street, where the rings are large enough to hold them.
  label('bike-station', 14);
}

/** Vehicles: the silhouette of their mode, turned to their course, larger when selected. */
function addVehicles(map: MapLibre): void {
  map.addLayer({
    id: 'explore-vehicle-selection',
    type: 'circle',
    source: 'explore-vehicles',
    filter: isSelected,
    paint: {
      'circle-radius': 15,
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#00a48e',
    },
  });
  addVehicleSymbols(map, false);
  addVehicleSymbols(map, true);
}

function addVehicleSymbols(map: MapLibre, directional: boolean): void {
  const isDirectional: ExpressionSpecification = [
    'match',
    ['get', 'icon'],
    [
      'subway-pointer',
      'subway-disc',
      'rail-pointer',
      'rail-disc',
      'aircraft-pointer',
      'aircraft-disc',
      'ship-pointer',
      'ship-disc',
      'ferry-pointer',
      'ferry-disc',
    ],
    true,
    false,
  ];
  map.addLayer({
    id: directional ? 'explore-vehicles-directional' : 'explore-vehicles',
    type: 'symbol',
    source: 'explore-vehicles',
    filter: directional ? isDirectional : ['!', isDirectional],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': directional ? 'map' : 'viewport',
      'icon-pitch-alignment': directional ? 'map' : 'viewport',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'selected'],
      'icon-size': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['case', isSelected, 1, 0.45],
        14,
        ['case', isSelected, 1.3, 0.75],
        17,
        ['case', isSelected, 1.4, 0.9],
      ],
    },
  });
}

/** The layers that can be clicked, top first. */
export const CLICKABLE = [
  'explore-vehicles-directional',
  'explore-vehicles',
  'explore-stations',
  'explore-parked',
] as const;

/** The live sources and layers on a freshly loaded style. */
export function addLiveLayers(map: MapLibre, dark: boolean): void {
  addMarkImages(map, dark);
  const empty = { type: 'FeatureCollection' as const, features: [] };
  map.addSource('explore-stations', { type: 'geojson', data: empty });
  map.addSource('explore-vehicles', { type: 'geojson', data: empty, promoteId: 'id' });
  addSelectedRoute(map);
  addParked(map, dark);
  addPlaces(map, dark);
  addTrails(map, dark);
  addVehicles(map);
}
