import type { LiveMode, LiveVehicle } from '@moviq/contracts';
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibre } from 'maplibre-gl';

import { modeColours } from './marks';
import type { LngLat } from './motion';

/** How long a drawn point stays in the trail behind its vehicle. */
export const TRAIL_MS = 30_000;
/** The trail fades towards its tail in these steps, oldest first. */
const STEPS = 3;
/** Closer than this to the last kept point, a drawn point adds nothing to the trail. */
const MIN_STEP_DEGREES = 0.00002;

interface TrailPoint {
  readonly at: LngLat;
  readonly time: number;
}

/** Each vehicle's recently drawn points, oldest first. */
export type Trails = Map<string, TrailPoint[]>;

/**
 * Adds the points just drawn and forgets the ones older than the trail. Vehicles no longer drawn
 * lose their trail. Returns whether any trail changed.
 */
export function recordTrails(
  trails: Trails,
  positions: ReadonlyMap<string, LngLat>,
  now: number,
): boolean {
  let changed = false;
  for (const id of trails.keys()) {
    if (!positions.has(id)) {
      trails.delete(id);
      changed = true;
    }
  }
  for (const [id, at] of positions) {
    const points = trails.get(id) ?? [];
    const last = points.at(-1);
    if (
      last === undefined ||
      Math.abs(last.at[0] - at[0]) + Math.abs(last.at[1] - at[1]) > MIN_STEP_DEGREES
    ) {
      points.push({ at, time: now });
      changed = true;
    }
    const kept = points.findIndex((point) => now - point.time <= TRAIL_MS);
    const stale = kept === -1 ? points.length - 1 : kept;
    if (stale > 0) {
      points.splice(0, stale);
      changed = true;
    }
    trails.set(id, points);
  }
  return changed;
}

interface TrailFeature {
  readonly type: 'Feature';
  readonly properties: { readonly mode: LiveMode; readonly step: number };
  readonly geometry: { readonly type: 'LineString'; readonly coordinates: [number, number][] };
}

/** Each trail cut into steps of age, the newest step the most opaque and joined to the mark. */
export function trailFeatures(
  trails: Trails,
  modes: ReadonlyMap<string, LiveMode>,
  now: number,
): { readonly type: 'FeatureCollection'; readonly features: TrailFeature[] } {
  const features: TrailFeature[] = [];
  const span = TRAIL_MS / STEPS;
  for (const [id, points] of trails) {
    const mode = modes.get(id);
    if (mode === undefined || points.length < 2) continue;
    for (let step = 0; step < STEPS; step += 1) {
      const from = now - TRAIL_MS + step * span;
      const to = from + span;
      const inside = points.filter((point) => point.time >= from && point.time <= to);
      const before = points.filter((point) => point.time < from).at(-1);
      const line = before === undefined ? inside : [before, ...inside];
      if (line.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: { mode, step },
        geometry: { type: 'LineString', coordinates: line.map((point) => [...point.at]) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Keeps the trail of every drawn vehicle and sends it to the map when it changes. `draw` returns
 * whether some trail is still fading, so the loop keeps going until the last one is gone.
 */
export function createTrailDrawer(source: GeoJSONSource | undefined) {
  const trails: Trails = new Map();
  return {
    draw(vehicles: readonly LiveVehicle[], positions: ReadonlyMap<string, LngLat>, now: number) {
      if (source === undefined || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return false;
      }
      if (!recordTrails(trails, positions, now)) {
        return [...trails.values()].some((points) => points.length > 1);
      }
      const modes = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.mode]));
      void source.setData(trailFeatures(trails, modes, now));
      return true;
    },
  };
}

export type TrailDrawer = ReturnType<typeof createTrailDrawer>;

/** The trails under the vehicles, in the colour of each mode, fading towards the tail. */
export function addTrails(map: MapLibre, dark: boolean): void {
  const colours = modeColours(dark);
  const colour = [
    'match',
    ['get', 'mode'],
    ...Object.entries(colours).flat(),
    colours.bus,
  ] as unknown as ExpressionSpecification;
  map.addSource('explore-trails', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'explore-trails',
    type: 'line',
    source: 'explore-trails',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': colour,
      'line-opacity': ['match', ['get', 'step'], 0, 0.18, 1, 0.42, 0.75],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 17, 4.5],
    },
  });
}
