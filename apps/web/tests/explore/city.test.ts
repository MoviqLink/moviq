import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { cityLayersResponseSchema, type BoundingBox } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  askable,
  drawnItems,
  FIRST_ON,
  itemTime,
  layersToAsk,
  listedItems,
  toneOf,
} from '../../src/features/explore/city/model/layers';
import {
  groupOnCount,
  layerAge,
  layersOf,
  noteOf,
} from '../../src/features/explore/city/model/panel';
import { cardEn } from '../../src/features/explore/city/texts-card-en';
import { cardEs } from '../../src/features/explore/city/texts-card-es';
import { cityEn } from '../../src/features/explore/city/texts-en';
import { cityEs } from '../../src/features/explore/city/texts-es';
import { cityLineFeatures, cityPointFeatures } from '../../src/features/explore/map/city-layer';
import { RADAR_TILES } from '../../src/features/explore/map/radar-layer';

/** `GET /api/city/layers` of every layer, built by the server over the captures of 11/11/2026. */
const answer = cityLayersResponseSchema.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/city-layers.json', import.meta.url)), 'utf8'),
  ),
);

/** The moment the answer was built: Wednesday 11/11/2026, 00:30 in New York. */
const NOW = Date.parse(answer.generatedAt);
const CITY: BoundingBox = [-74.26, 40.49, -73.69, 40.92];
const STREET: BoundingBox = [-73.99, 40.765, -73.98, 40.772];

describe('which city layers are asked', () => {
  it('opens with no city layers, and asks only the layers on', () => {
    expect([...FIRST_ON]).toEqual([]);
    expect(layersToAsk(new Set(['cameras', 'incidents']), CITY)).toEqual(['cameras', 'incidents']);
  });

  it('waits for a street in view before asking meters, and asks signs by their own route', () => {
    expect(askable('parking-meters', CITY)).toBe(false);
    expect(askable('parking-meters', STREET)).toBe(true);
    expect(layersToAsk(new Set(['parking-meters', 'parking-signs']), CITY)).toEqual([]);
    expect(layersToAsk(new Set(['parking-meters', 'parking-signs']), STREET)).toEqual([
      'parking-meters',
    ]);
  });
});

describe('what the panel and the map show of the answer', () => {
  it('draws only the placed items of the layers on', () => {
    const drawn = drawnItems(answer.items, new Set(['cameras', 'permitted-events']));
    expect(drawn.map((item) => item.layer)).toEqual(['cameras', 'cameras', 'cameras', 'cameras']);
  });

  it('lists the events with a permit of today by their start, as they have no place', () => {
    const listed = listedItems(answer.items, 'permitted-events', NOW);
    expect(listed).toHaveLength(8);
    const today = listed.slice(0, 7).map((item) => itemTime(item, NOW));
    expect(today.every((time) => time?.until === false)).toBe(true);
    const starts = today.map((time) => Date.parse(time?.at ?? ''));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('lists a permit in force since another day until it ends, never by its 2024 start', () => {
    const listed = listedItems(answer.items, 'permitted-events', NOW);
    const closure = listed.at(-1);
    if (closure?.detail.kind !== 'permitted-event') throw new Error('No permit since 2024');
    expect(closure.detail.startsAt).toBe('2024-06-30T12:00:00.000Z');
    expect(itemTime(closure, NOW)).toEqual({ at: closure.detail.endsAt, until: true });
    const ending = (end: string) => ({ ...closure, detail: { ...closure.detail, endsAt: end } });
    const later = ending('2026-12-01T05:00:00.000Z');
    const sooner = ending('2026-11-20T05:00:00.000Z');
    const order = listedItems([later, closure, sooner], 'permitted-events', NOW);
    expect(order).toEqual([sooner, later, closure]);
  });

  it('writes a permit in force since another day as “until” its end, in both languages', () => {
    expect(cityEn.untilDay('Thu, Dec 31 · 11:00 PM')).toBe('until Thu, Dec 31 · 11:00 PM');
    expect(cityEs.untilDay('jue, 31 dic · 23:00')).toBe('hasta el jue, 31 dic · 23:00');
    expect(cityEs.untilTime('23:00')).toBe('hasta las 23:00');
    expect(cityEs.untilTime('1:00')).toBe('hasta la 1:00');
  });

  it('says why a layer on draws nothing: too far out, not answered, none in the box', () => {
    const answered = new Set(answer.asked);
    expect(noteOf('parking-meters', answer, CITY, answer.items, answered, NOW)).toEqual({
      kind: 'zoom',
    });
    expect(noteOf('cameras', answer, CITY, answer.items, new Set(), NOW)).toEqual({
      kind: 'loading',
    });
    expect(noteOf('cameras', answer, CITY, answer.items, answered, NOW)).toEqual({ kind: 'drawn' });
    expect(noteOf('weather-alerts', answer, CITY, answer.items, answered, NOW)).toEqual({
      kind: 'none',
    });
    expect(noteOf('street-permits', answer, CITY, answer.items, answered, NOW)).toEqual({
      kind: 'permits',
    });
    const capped = { ...answer, capped: [{ layer: 'cameras' as const, inBox: 3000 }] };
    expect(noteOf('cameras', capped, CITY, answer.items, answered, NOW)).toEqual({
      kind: 'capped',
      inBox: 3000,
    });
  });

  it('counts the layers on in each group, the radar with the weather', () => {
    const weather = layersOf(answer, 'weather');
    expect(weather.map((summary) => summary.layer)).toEqual(['road-conditions', 'weather-alerts']);
    expect(groupOnCount(weather, new Set(['road-conditions']), { on: true })).toEqual({
      on: 2,
      all: 3,
    });
  });

  it('dates a layer by its oldest source with data', () => {
    const permits = answer.layers.find((summary) => summary.layer === 'street-permits');
    if (permits === undefined) throw new Error('No permits layer in the answer');
    const sources = answer.sources.map((source) =>
      source.provenance.sourceId === 'nyc-street-permits-staten-island'
        ? { ...source, provenance: { ...source.provenance, ageSeconds: 600 } }
        : source,
    );
    expect(layerAge(permits, sources)).toEqual({ kind: 'age', seconds: 600 });
  });
});

describe('the marks of the city layers', () => {
  it('colours what is closed red, risks amber and places in ink, and marks the selection', () => {
    expect([toneOf('closures'), toneOf('incidents'), toneOf('cameras')]).toEqual([
      'closed',
      'risk',
      'place',
    ]);
    const closures = answer.items.filter((item) => item.layer === 'closures');
    const covered = closures.find((item) => item.lines.length > 0);
    const lines = cityLineFeatures(closures, covered?.id ?? null).features;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.find((line) => line.properties.id === covered?.id)?.properties).toMatchObject({
      tone: 'closed',
      selected: 1,
    });
    const points = cityPointFeatures(closures, null).features;
    expect(points.every((feature) => feature.properties.selected === 0)).toBe(true);
  });

  it('asks NOAA’s radar mosaic with the address given, in Web Mercator tiles', () => {
    expect(RADAR_TILES).toBe(
      'https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?SERVICE=WMS&VERSION=1.3.0' +
        '&REQUEST=GetMap&LAYERS=conus_bref_qcd&STYLES=&FORMAT=image/png&TRANSPARENT=true' +
        '&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    );
  });
});

/** Every key of a dictionary, nested, with the kind of each value. */
function shape(value: unknown, path = ''): string[] {
  if (typeof value !== 'object' || value === null) return [`${path}:${typeof value}`];
  return Object.entries(value).flatMap(([key, inner]) => shape(inner, `${path}.${key}`));
}

describe('the words of the city layers', () => {
  it('has the same keys in English and Spanish', () => {
    expect(shape(cityEs)).toEqual(shape(cityEn));
    expect(shape(cardEs)).toEqual(shape(cardEn));
  });

  it('never says a charger, a space or a sign is free or allowed now', () => {
    expect(Object.values(cardEn.charger.listing)).toEqual([
      'Open',
      'Planned',
      'Temporarily unavailable',
    ]);
    expect(cityEn.marks['parking-signs']).toBe('Sign text as posted, never “allowed now”');
    expect(cityEn.marks['parking-meters']).toContain('not a free space');
    expect(cityEs.marks['street-permits']).toBe('Permiso: no implica obra ni corte');
  });
});
