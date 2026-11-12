import type { MovIqEvent } from '@moviq/contracts';
import type { ExpressionSpecification, Map as MapLibre } from 'maplibre-gl';

export const EVENTS_LAYER = 'explore-events';

/** MovIQ's own lime, the colour of its mark: an event is no operator's. Called off: grey. */
const coloursOf = (dark: boolean) =>
  dark
    ? { event: '#a3e635', off: '#8d99a3', paper: '#12181e' }
    : { event: '#4d7c0f', off: '#7f8b95', paper: '#ffffff' };

const isSelected: ExpressionSpecification = ['==', ['get', 'selected'], 1];

/** Events as dots under the vehicles, larger near the street and when selected. */
export function addEventLayer(map: MapLibre, dark: boolean): void {
  const colours = coloursOf(dark);
  map.addSource(EVENTS_LAYER, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer(
    {
      id: EVENTS_LAYER,
      type: 'circle',
      source: EVENTS_LAYER,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          10,
          ['case', isSelected, 7, 4],
          14,
          ['case', isSelected, 10, 7],
        ],
        'circle-color': ['case', ['==', ['get', 'off'], 1], colours.off, colours.event],
        'circle-stroke-width': ['case', isSelected, 3, 2],
        'circle-stroke-color': colours.paper,
      },
    },
    map.getLayer('explore-vehicles') === undefined ? undefined : 'explore-vehicles',
  );
}

/** The events as GeoJSON points at their venues; one called off or moved is drawn grey. */
export function eventFeatures(events: readonly MovIqEvent[], selected: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: events.map((event) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [event.venue.lon, event.venue.lat] },
      properties: {
        id: event.id,
        selected: event.id === selected ? 1 : 0,
        off: event.status === 'scheduled' ? 0 : 1,
      },
    })),
  };
}
