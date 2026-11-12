import { describe, expect, it } from 'vitest';

import { busSources } from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { occupancyOf } from '../../src/modules/live/feeds/bus.js';
import { parsedCapture } from './reader.js';

/** Bus Time at 03:42 UTC on 11/11/2026: 28 buses, 15 with occupancy (`tests/fixtures/mta/`). */
const counted = parsedCapture(busSources[0], 'mta/bus-occupancy.pb', '2026-11-11T03:42:02Z');

describe('the occupancy of an MTA bus on its card', () => {
  it('travels with a bus that counts its passengers and its room, as the bus sends them', () => {
    const bus = counted.vehicles.find((one) => one.vehicleId === 'MTA NYCT_7117');
    expect(occupancyOf(bus?.occupancy ?? null)).toEqual({ passengers: 7, capacity: 80 });
  });

  it('is left empty for a bus that sends a level alone or nothing, never derived', () => {
    for (const one of counted.vehicles) {
      const sent = one.occupancy;
      const both = (sent?.passengers ?? null) !== null && (sent?.capacity ?? null) !== null;
      expect(occupancyOf(sent) === null, one.vehicleId).toBe(!both);
    }
    expect(counted.vehicles.some((one) => occupancyOf(one.occupancy) === null)).toBe(true);
    expect(occupancyOf({ level: 'FEW_SEATS_AVAILABLE', passengers: null, capacity: null })).toBe(
      null,
    );
  });
});
