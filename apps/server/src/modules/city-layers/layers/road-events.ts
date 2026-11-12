import type { CityItem, CityLayerId } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import type { RoadEventLayer } from '../../data-platform/sources/ny511/events.js';
import { placeOf } from '../geometry.js';
import { part, type LayerPart } from '../layer.js';

/** A 511NY event layer as items of a city layer, in 511NY's own words and with its time. */
export function roadEventPart(
  layer: CityLayerId,
  source: SourceDefinition<RoadEventLayer>,
): LayerPart {
  return part({
    source,
    items: (data): CityItem[] =>
      data.events.map((event) => ({
        id: `${layer}:${event.id}`,
        layer,
        sourceId: source.id,
        title: event.title,
        ...placeOf(event.geometry),
        detail: {
          kind: 'road-event',
          headline: event.headline,
          agency: event.agency,
          description: event.description,
          road: event.road,
          place: event.place,
          active: event.active,
          startsAt: event.startsAt,
          periods: event.periods,
          updatedAt: event.updatedAt,
        },
      })),
  });
}
