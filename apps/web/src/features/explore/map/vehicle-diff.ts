import type { LiveVehicle } from '@moviq/contracts';
import type { GeoJSONSourceDiff } from 'maplibre-gl';

import type { LngLat } from './motion';
import { vehicleSymbol } from './marks';

interface VehicleMark {
  readonly at: LngLat;
  readonly icon: string;
  readonly bearing: number;
  readonly selected: number;
}
export type VehicleMarks = ReadonlyMap<string, VehicleMark>;

const samePosition = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];
const propertiesOf = (mark: VehicleMark) => ({
  icon: mark.icon,
  bearing: mark.bearing,
  selected: mark.selected,
});

/** Send only changed geometry/properties to the worker; unchanged vehicles retain their data. */
export function vehicleDiff(
  previous: VehicleMarks,
  vehicles: readonly LiveVehicle[],
  positions: ReadonlyMap<string, LngLat>,
  selected: string | null,
  bearings?: ReadonlyMap<string, number>,
): { marks: VehicleMarks; diff: GeoJSONSourceDiff } {
  const marks = new Map<string, VehicleMark>();
  const diff: Required<Pick<GeoJSONSourceDiff, 'add' | 'update' | 'remove'>> = {
    add: [],
    update: [],
    remove: [],
  };
  for (const vehicle of vehicles) {
    const old = previous.get(vehicle.id);
    const symbol = vehicleSymbol(vehicle);
    const mark: VehicleMark = {
      at: positions.get(vehicle.id) ?? [vehicle.position.lon, vehicle.position.lat],
      icon: symbol.icon,
      bearing: bearings?.get(vehicle.id) ?? symbol.bearing,
      selected: vehicle.id === selected ? 1 : 0,
    };
    const geometry = { type: 'Point' as const, coordinates: [mark.at[0], mark.at[1]] };
    if (old === undefined) {
      diff.add.push({
        type: 'Feature',
        properties: { id: vehicle.id, ...propertiesOf(mark) },
        geometry,
      });
    } else {
      const moved = !samePosition(old.at, mark.at);
      const changed =
        old.icon !== mark.icon || old.bearing !== mark.bearing || old.selected !== mark.selected;
      if (moved || changed) {
        diff.update.push({
          id: vehicle.id,
          ...(moved ? { newGeometry: geometry } : {}),
          ...(changed
            ? {
                addOrUpdateProperties: Object.entries(propertiesOf(mark)).map(([key, value]) => ({
                  key,
                  value,
                })),
              }
            : {}),
        });
      }
    }
    marks.set(vehicle.id, mark);
  }
  for (const id of previous.keys()) if (!marks.has(id)) diff.remove.push(id);
  return { marks, diff };
}

export const hasVehicleChanges = (diff: GeoJSONSourceDiff): boolean =>
  (diff.add?.length ?? 0) + (diff.update?.length ?? 0) + (diff.remove?.length ?? 0) > 0;
