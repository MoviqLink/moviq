import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';

import { withoutClutter } from '../src/shared/map/base-style';

const NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
const REF = ['to-string', ['get', 'ref']];
const LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];

const label = (id: string, sourceLayer: string, text: unknown): LayerSpecification =>
  ({
    id,
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': sourceLayer,
    filter: LINE,
    layout: { 'text-field': text },
  }) as LayerSpecification;

/** The labels of OpenFreeMap's Dark and Positron styles as served on 11/11/2026, cut down. */
const style: StyleSpecification = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background' },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': '#000', 'fill-pattern': 'wave' },
    },
    label('highway_name_other', 'transportation_name', NAME),
    // Dark writes the motorways by their reference: `I 95;NJTP`, `HH;NY 9A`.
    label('highway_name_motorway', 'transportation_name', REF),
    label('highway-shield-us-interstate', 'transportation_name', REF),
    label('road_ref_legacy', 'transportation_name', '{ref}'),
    label('place_suburb', 'place', NAME),
    label('poi_r1', 'poi', NAME),
  ],
};

describe('the base map shared by Explore and the trip', () => {
  it('writes names of streets and places, never road references or shields', () => {
    const ids = withoutClutter(undefined, style).layers.map((layer) => layer.id);
    expect(ids).toEqual(['background', 'water', 'highway_name_other', 'place_suburb']);
  });

  it('writes no label smaller than 11 px, as Dark writes its streets at 10', () => {
    const small = {
      ...style,
      layers: [
        {
          ...label('place_suburb', 'place', NAME),
          layout: { 'text-field': NAME, 'text-size': 10 },
        } as LayerSpecification,
      ],
    };
    const [suburb] = withoutClutter(undefined, small).layers;
    expect(suburb?.type === 'symbol' && suburb.layout?.['text-size']).toBe(11);
  });

  it('draws fills in their plain colour, without textures missing from the sprites', () => {
    const water = withoutClutter(undefined, style).layers.find((layer) => layer.id === 'water');
    expect(water?.type === 'fill' && water.paint).toEqual({ 'fill-color': '#000' });
  });
});
