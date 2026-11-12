import type { LiveVehicle } from '@moviq/contracts';
import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { vehicleFeatures, vehicleSymbol } from './marks';
import {
  bearingAt,
  isGliding,
  positionAt,
  retarget,
  type LngLat,
  type Path,
  type Track,
} from './motion';
import { railTransition } from './rail-motion';
import { createTrailDrawer, type TrailDrawer } from './trails';
import { hasVehicleChanges, vehicleDiff, type VehicleMarks } from './vehicle-diff';

/** At most about 12 submissions per second to the rendering worker. */
const FRAME_MS = 1000 / 12;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Fleet {
  readonly vehicles: readonly LiveVehicle[];
  readonly selected: string | null;
  readonly route: readonly LngLat[] | null;
}

/** Trains of the selected line follow its verified shape instead of crossing a bend. */
function railPaths(fleet: Fleet): (id: string, from: LngLat, to: LngLat) => Path | null {
  const chosen = fleet.vehicles.find((vehicle) => vehicle.id === fleet.selected);
  const route = fleet.route;
  if (chosen === undefined || route === null) return () => null;
  if (chosen.mode !== 'subway' && chosen.mode !== 'rail') return () => null;
  const sameLine = new Set(
    fleet.vehicles
      .filter(
        (vehicle) =>
          vehicle.mode === chosen.mode &&
          vehicle.sourceId === chosen.sourceId &&
          vehicle.line?.id === chosen.line?.id,
      )
      .map((vehicle) => vehicle.id),
  );
  return (id, from, to) => (sameLine.has(id) ? railTransition(from, to, route) : null);
}

/** Where every mark is drawn at `now`, its course, and whether any still has way to go. */
function frameOf(tracks: ReadonlyMap<string, Track>, now: number) {
  const positions = new Map<string, LngLat>();
  const bearings = new Map<string, number>();
  let gliding = false;
  for (const [id, track] of tracks) {
    positions.set(id, positionAt(track, now));
    bearings.set(id, Math.round(bearingAt(track, now)) % 360);
    gliding ||= isGliding(track, now);
  }
  return { positions, bearings, gliding };
}

/**
 * One animation loop for the whole vehicle layer. Each answer gives every vehicle a glide from
 * where it is drawn to its new reading; the loop draws them at most 12 times a second, waits for
 * the worker between submissions, pauses while the map is being moved, and stops when the page is
 * hidden or nothing is left to move.
 */
function createMover(map: MapLibre, source: GeoJSONSource, trails: TrailDrawer) {
  let fleet: Fleet = { vehicles: [], selected: null, route: null };
  let tracks = new Map<string, Track>();
  let marks: VehicleMarks = new Map();
  let failed = false;
  let busy = false;
  let dirty = false;
  let frame = 0;
  let last = -Infinity;
  let stopped = false;

  const draw = (now: number) => {
    const { positions, bearings, gliding } = frameOf(tracks, now);
    const next = vehicleDiff(marks, fleet.vehicles, positions, fleet.selected, bearings);
    dirty = false;
    if (failed || hasVehicleChanges(next.diff)) {
      busy = true;
      const update = failed
        ? source.setData(vehicleFeatures(fleet.vehicles, positions, fleet.selected))
        : source.updateData(next.diff);
      void update.then(
        () => {
          marks = next.marks;
          failed = false;
          busy = false;
        },
        () => {
          failed = true;
          busy = false;
        },
      );
    }
    return trails.draw(fleet.vehicles, positions, now) || gliding;
  };

  const tick = (now: number) => {
    frame = 0;
    if (stopped || document.hidden) return;
    let more = true;
    if (!busy && !map.isMoving() && now - last >= FRAME_MS) {
      last = now;
      more = draw(now) || dirty;
    }
    if (more || busy) frame = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (frame === 0 && !stopped && !document.hidden) frame = requestAnimationFrame(tick);
  };

  const visibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else wake();
  };
  document.addEventListener('visibilitychange', visibility);
  map.on('moveend', wake);

  return {
    update(next: Fleet) {
      if (next.vehicles !== fleet.vehicles) {
        const readings = next.vehicles.map((vehicle) => ({
          id: vehicle.id,
          mode: vehicle.mode,
          at: [vehicle.position.lon, vehicle.position.lat] as const,
          bearing: vehicleSymbol(vehicle).bearing,
        }));
        tracks = retarget(tracks, readings, performance.now(), {
          glide: !reducedMotion() && !document.hidden,
          pathFor: railPaths(next),
        });
      }
      fleet = next;
      dirty = true;
      wake();
    },
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      map.off('moveend', wake);
    },
  };
}

/** Vehicles glide between their real readings, under one loop for the whole layer. */
export function useMovingMarks(
  map: MapLibre | null,
  vehicles: readonly LiveVehicle[],
  selected: string | null,
  route: readonly LngLat[] | null,
): void {
  const mover = useRef<ReturnType<typeof createMover> | null>(null);
  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>('explore-vehicles');
    if (map === null || source === undefined) return;
    const trails = createTrailDrawer(map.getSource<GeoJSONSource>('explore-trails'));
    const created = createMover(map, source, trails);
    mover.current = created;
    return () => {
      created.stop();
      mover.current = null;
    };
  }, [map]);
  useEffect(() => {
    mover.current?.update({ vehicles, selected, route });
  }, [map, vehicles, selected, route]);
}
