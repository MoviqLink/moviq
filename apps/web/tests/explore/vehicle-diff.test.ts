import { liveVehiclesResponseSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { needsNewBounds } from '../../src/features/explore/map/bounds';
import { hasVehicleChanges, vehicleDiff } from '../../src/features/explore/map/vehicle-diff';
import live from './fixtures/live-city.json';

const vehicles = liveVehiclesResponseSchema.parse(live).vehicles;
const bus = vehicles.find((item) => item.id === 'bus:MTA NYCT_8440');
if (bus === undefined) throw new Error('The recorded bus is required.');

describe('incremental vehicle rendering', () => {
  const initial = vehicleDiff(new Map(), vehicles, new Map(), null);

  it('does no worker work for identical positions despite a newly parsed response', () => {
    const repeated = vehicleDiff(
      initial.marks,
      liveVehiclesResponseSchema.parse(live).vehicles,
      new Map(),
      null,
    );
    expect(hasVehicleChanges(repeated.diff)).toBe(false);
  });

  it('sends one geometry when only one vehicle moves, without replacing the fleet', () => {
    const positions = new Map([[bus.id, [-73.76, 40.68] as const]]);
    const changed = vehicleDiff(initial.marks, vehicles, positions, null);
    expect(changed.diff.add).toEqual([]);
    expect(changed.diff.remove).toEqual([]);
    expect(changed.diff.update).toEqual([
      { id: bus.id, newGeometry: { type: 'Point', coordinates: [-73.76, 40.68] } },
    ]);
  });

  it('updates selection without moving geometry and removes missing vehicles', () => {
    const selected = vehicleDiff(initial.marks, vehicles, new Map(), bus.id);
    expect(selected.diff.update).toHaveLength(1);
    expect(selected.diff.update?.[0]?.newGeometry).toBeUndefined();
    const removed = vehicleDiff(
      selected.marks,
      vehicles.filter((item) => item.id !== bus.id),
      new Map(),
      null,
    );
    expect(removed.diff.remove).toEqual([bus.id]);
    expect(removed.diff.update).toEqual([]);
  });
});

describe('viewport request budget', () => {
  it('reuses the fetched margin while following a vehicle or making a small pan', () => {
    expect(needsNewBounds([-74.1, 40.6, -73.8, 40.9], [-74.0, 40.7, -73.9, 40.8])).toBe(false);
  });
  it('fetches the first view, newly exposed ground and a substantially closer view', () => {
    expect(needsNewBounds(null, [-74.0, 40.7, -73.9, 40.8])).toBe(true);
    expect(needsNewBounds([-74.1, 40.6, -73.8, 40.9], [-74.2, 40.7, -73.9, 40.8])).toBe(true);
    expect(needsNewBounds([-74.1, 40.6, -73.8, 40.9], [-74.0, 40.7, -73.99, 40.71])).toBe(true);
  });
});
