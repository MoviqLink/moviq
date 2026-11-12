import { liveVehicleSchema } from '@moviq/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createSourceReader, type SourceReader } from '../../src/modules/data-platform/reader.js';
import {
  busSources,
  busPositionsSchema,
} from '../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { createVirtualBusReader } from '../../src/modules/live/virtual-bus.js';
import { liveCity, type LiveCity } from './city.js';
import { BUS_8440 } from './feeds.js';

let city: LiveCity | undefined;
afterEach(async () => {
  await city?.dispose();
});

async function world() {
  city = await liveCity();
  await city.collect();
  const reader = createSourceReader({ db: city.db, clock: city.clock, missingVariables: () => [] });
  return { city, read: createVirtualBusReader({ city: city.live, reader, clock: city.clock }) };
}

describe('virtual boarding reads admitted bus GPS and timed stops', () => {
  it('returns the published fix, coordinates and up to eight timed stops', async () => {
    const { read } = await world();
    const result = await read(`bus:${BUS_8440}`);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('Captured bus unavailable');
    expect(liveVehicleSchema.safeParse(result.vehicle).success).toBe(true);
    expect(result.vehicle.position.basis).toBe('gps');
    expect(result.vehicle.position.dataTime).toBe('2026-11-11T01:05:10.000Z');
    expect(result.stops.length).toBeGreaterThan(3);
    expect(result.stops.length).toBeLessThanOrEqual(8);
    expect(
      result.stops.every((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon)),
    ).toBe(true);
    expect(result.stops.every((stop) => stop.arrival !== null || stop.departure !== null)).toBe(
      true,
    );
    expect(result.sources.some((source) => source.provenance.sourceId === busSources[1].id)).toBe(
      true,
    );
  });

  it('does not invent a bus for other modes or unknown identifiers', async () => {
    const { read } = await world();
    expect(await read('subway:123')).toBeNull();
    expect(await read('bus:unknown')).toBeNull();
  });

  it('refuses stale data instead of presenting a last fix as live', async () => {
    const { city: active, read } = await world();
    expect(await read(`bus:${BUS_8440}`)).not.toBeNull();
    active.clock.advance(180_000);
    expect(await read(`bus:${BUS_8440}`)).toBeNull();
  });

  it('refuses new invitations when a feed fails even while its last copy exists', async () => {
    const { city: active, read } = await world();
    expect(await read(`bus:${BUS_8440}`)).not.toBeNull();
    await active.collect([busSources[0]], new Map([[busSources[0].id, { status: 503 }]]));
    expect(await read(`bus:${BUS_8440}`)).toBeNull();
  });
  it.each([-121_000, 31_000])(
    'rejects an individual GPS fix %i ms from now even in healthy feeds',
    async (offset) => {
      const { city: active } = await world();
      const base = createSourceReader({
        db: active.db,
        clock: active.clock,
        missingVariables: () => [],
      });
      const changed: SourceReader = {
        async read(definition) {
          const reading = await base.read(definition);
          if (definition.id !== busSources[0].id) return reading;
          const positions = busPositionsSchema.parse(reading.data);
          return {
            ...reading,
            data: definition.dataSchema.parse({
              ...positions,
              vehicles: positions.vehicles.map((bus) =>
                bus.vehicleId === BUS_8440
                  ? {
                      ...bus,
                      observedAt: new Date(active.clock.now().getTime() + offset).toISOString(),
                    }
                  : bus,
              ),
            }),
          };
        },
      };
      const read = createVirtualBusReader({
        city: active.live,
        reader: changed,
        clock: active.clock,
      });
      expect(await read(`bus:${BUS_8440}`)).toBeNull();
    },
  );
});
