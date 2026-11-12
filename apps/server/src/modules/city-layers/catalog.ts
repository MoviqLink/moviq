import {
  toInstant,
  type BoundingBox,
  type CityItem,
  type CityLayerId,
  type CityLayersResponse,
  type LiveSource,
} from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { SourceReader } from '../data-platform/reader.js';
import { inBox } from './geometry.js';
import type { CityLayer, LayerReading } from './layer.js';
import { harborLayers } from './layers/harbor.js';
import { placeLayers } from './layers/places.js';
import { streetLayers } from './layers/street.js';
import { transitLayers } from './layers/transit.js';
import { weatherLayers } from './layers/weather.js';

/** Every layer the platform feeds, in the order of the panel. */
const defaultCityLayers = (): readonly CityLayer[] => [
  ...transitLayers,
  ...streetLayers,
  ...placeLayers,
  ...harborLayers,
  ...weatherLayers,
];

/** The fastest of these sources changes every minute: every screen shares one read of 15 s. */
const CITY_SNAPSHOT_MS = 15_000;

/**
 * At most this many items of one layer travel in one answer; with more in the box the layer is
 * listed in `capped` with how many the box holds, and the screen asks to zoom in.
 */
export const ITEMS_PER_LAYER = 2_500;

export interface CityCatalogDependencies {
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** `defaultCityLayers()` when absent. */
  readonly layers?: readonly CityLayer[];
}

interface Snapshot {
  readonly generatedAt: string;
  readonly readings: ReadonlyMap<CityLayerId, LayerReading>;
}

/** What one screen asks: the box in view and the layers it shows. */
interface CityQuery {
  readonly box: BoundingBox | undefined;
  readonly layers: ReadonlySet<CityLayerId>;
}

function uniqueSources(readings: Iterable<LayerReading>): LiveSource[] {
  const byId = new Map<string, LiveSource>();
  for (const reading of readings) {
    for (const source of reading.sources) byId.set(source.provenance.sourceId, source);
  }
  return [...byId.values()];
}

function answer(
  layers: readonly CityLayer[],
  snapshot: Snapshot,
  query: CityQuery,
): CityLayersResponse {
  const items: CityItem[] = [];
  const capped: CityLayersResponse['capped'] = [];
  for (const layer of layers) {
    const reading = snapshot.readings.get(layer.id);
    if (reading === undefined || !query.layers.has(layer.id)) continue;
    const inside = reading.items.filter((item) => inBox(item, query.box));
    if (inside.length > ITEMS_PER_LAYER) capped.push({ layer: layer.id, inBox: inside.length });
    else items.push(...inside);
  }
  return {
    generatedAt: snapshot.generatedAt,
    bbox: query.box ?? null,
    asked: layers.map((layer) => layer.id).filter((id) => query.layers.has(id)),
    layers: layers.flatMap((layer) => {
      const reading = snapshot.readings.get(layer.id);
      if (reading === undefined) return [];
      return [
        {
          layer: layer.id,
          group: layer.group,
          status: reading.status,
          count: reading.count,
          breakdown: [...reading.breakdown],
          leftOut: reading.leftOut,
          sourceIds: reading.sources.map((source) => source.provenance.sourceId),
        },
      ];
    }),
    items,
    capped,
    sources: uniqueSources(snapshot.readings.values()),
  };
}

/**
 * Every city layer read through the data platform, once every 15 seconds for every screen; each
 * screen gets the layers it asks for, inside its box, and the count of all of them.
 */
export function createCityCatalog(deps: CityCatalogDependencies) {
  const layers = deps.layers ?? defaultCityLayers();
  let cached: { readonly at: number; readonly value: Promise<Snapshot> } | undefined;
  const build = async (): Promise<Snapshot> => {
    const now = deps.clock.now();
    const readings = await Promise.all(layers.map((layer) => layer.read(deps.reader, now)));
    return {
      generatedAt: toInstant(now),
      readings: new Map(
        layers.flatMap((layer, index) => {
          const reading = readings[index];
          return reading === undefined ? [] : [[layer.id, reading] as const];
        }),
      ),
    };
  };
  const snapshot = (): Promise<Snapshot> => {
    const now = deps.clock.now().getTime();
    if (cached === undefined || now - cached.at >= CITY_SNAPSHOT_MS) {
      const value = build();
      cached = { at: now, value };
      value.catch(() => {
        if (cached?.value === value) cached = undefined;
      });
    }
    return cached.value;
  };
  return {
    async list(query: CityQuery): Promise<CityLayersResponse> {
      return answer(layers, await snapshot(), query);
    },
  };
}
