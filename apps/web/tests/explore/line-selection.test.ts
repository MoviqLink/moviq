import { describe, expect, it } from 'vitest';
import {
  lineKey,
  matchesLine,
  matchesSearch,
  searchRank,
} from '../../src/features/explore/model/line-selection';
import { layersToRestore } from '../../src/features/explore/destinations/layer-restore';
import { FIRST_ON } from '../../src/features/explore/city/model/layers';
import { liveVehiclesResponseSchema } from '@moviq/contracts';
import city from './fixtures/live-city.json';

describe('map line choices', () => {
  it('distinguishes networks and filters by the exact composite identity', () => {
    const vehicle = liveVehiclesResponseSchema
      .parse(city)
      .vehicles.find((item) => item.line !== null);
    if (vehicle === undefined || vehicle.line === null) throw new Error('fixture has no line');
    const line = { mode: vehicle.mode, sourceId: vehicle.sourceId, lineId: vehicle.line.id };
    const other = { ...line, sourceId: 'another-network' };
    expect(lineKey(line)).not.toBe(lineKey(other));
    expect(matchesLine(vehicle, [line])).toBe(true);
    expect(matchesLine(vehicle, [other])).toBe(false);
    expect(matchesLine(vehicle, [])).toBe(false);
  });
  it('prioritizes exact names over prefixes and descriptions, including A and M15', () => {
    expect(searchRank('A', '8 Avenue', 'a')).toBe(0);
    expect(searchRank('A1', null, 'A')).toBe(1);
    expect(searchRank('M15', 'East Harlem', 'm15')).toBe(0);
    expect(searchRank('M15-SBS', null, 'M15')).toBe(1);
    expect(searchRank('Q20', 'Jamaica', 'A')).toBe(3);
    expect(matchesSearch('Q20', 'Jamaica', 'xyz')).toBe(false);
  });
  it('starts with no city layers and restores explicit choices after a specialised view', () => {
    expect(FIRST_ON.size).toBe(0);
    const saved = new Set(['landmarks']);
    const specialised = new Set(['landmarks', 'incidents', 'cameras']);
    expect(layersToRestore(specialised, saved)).toEqual(['incidents', 'cameras']);
    expect(layersToRestore(new Set(['incidents']), saved)).toEqual(['incidents', 'landmarks']);
  });
});
