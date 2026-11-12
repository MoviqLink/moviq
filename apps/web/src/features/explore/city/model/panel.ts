import type {
  BoundingBox,
  CityGroup,
  CityItem,
  CityLayerId,
  CityLayerSummary,
  CityLayersResponse,
  LiveSource,
} from '@moviq/contracts';

import { oldestAge, type SourceAge } from '../../model/source';
import { askable, listedItems } from './layers';

/** The layers of one group, in the order the server gives them. */
export const layersOf = (data: CityLayersResponse | null, group: CityGroup): CityLayerSummary[] =>
  (data?.layers ?? []).filter((summary) => summary.group === group);

/** The age of a layer by its sources (see `oldestAge`); null without data. */
export const layerAge = (
  summary: CityLayerSummary,
  sources: readonly LiveSource[],
): SourceAge | null =>
  oldestAge(sources.filter((source) => summary.sourceIds.includes(source.provenance.sourceId)));

/** What a layer that is on says under its row, besides its list. */
export type LayerNote =
  | { readonly kind: 'zoom' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'capped'; readonly inBox: number }
  | { readonly kind: 'none' }
  | { readonly kind: 'listed'; readonly items: readonly CityItem[] }
  | { readonly kind: 'drawn' }
  | { readonly kind: 'permits' };

/**
 * Why a layer on shows what it shows: street permits by borough, too far out to ask it, not
 * answered yet, too many in the box, a list of what has no place, marks, or nothing in the box.
 * `answered` holds the layers whose items have arrived; `now` dates the list.
 */
export function noteOf(
  layer: CityLayerId,
  data: CityLayersResponse,
  box: BoundingBox,
  items: readonly CityItem[],
  answered: ReadonlySet<CityLayerId>,
  now: number,
): LayerNote {
  if (layer === 'street-permits') return { kind: 'permits' };
  if (!askable(layer, box)) return { kind: 'zoom' };
  if (!answered.has(layer)) return { kind: 'loading' };
  const capped = data.capped.find((row) => row.layer === layer);
  if (capped !== undefined) return { kind: 'capped', inBox: capped.inBox };
  const listed = listedItems(items, layer, now);
  if (listed.length > 0) return { kind: 'listed', items: listed };
  return items.some((item) => item.layer === layer) ? { kind: 'drawn' } : { kind: 'none' };
}

/** How many layers of a group are on, out of how many it has. */
export function groupOnCount(
  layers: readonly CityLayerSummary[],
  on: ReadonlySet<CityLayerId>,
  extra: { readonly on: boolean } | undefined,
): { readonly on: number; readonly all: number } {
  const count = layers.filter((summary) => on.has(summary.layer)).length;
  return {
    on: count + (extra?.on === true ? 1 : 0),
    all: layers.length + (extra === undefined ? 0 : 1),
  };
}
