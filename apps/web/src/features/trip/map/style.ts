import type { Map as MapLibre } from 'maplibre-gl';

import { addBuildings, quietBaseMap } from '../../../shared/map/base-style';

export const routeColors = (dark: boolean) =>
  dark
    ? { ride: '#3fc5b4', walk: '#8a96a1', taxi: '#9d94ff', risk: '#f2a33a', casing: '#0c1014' }
    : { ride: '#0e9f8a', walk: '#8a939c', taxi: '#5b4ef0', risk: '#e58a00', casing: '#ffffff' };

/** Quiets the base map like a scale model and raises the buildings, so the route stands out. */
export function tuneBaseMap(map: MapLibre, dark: boolean): void {
  quietBaseMap(map, dark);
  addBuildings(map, 'buildings-3d', dark);
}
