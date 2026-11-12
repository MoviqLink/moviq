import { describe, expect, it } from 'vitest';

import { passioRouteSource } from '../../src/modules/data-platform/sources/shuttles/passio-routes.js';
import { liveCity, LIVE_DEFINITIONS, OTHER_SOURCES } from './city.js';

describe('live line directory and selection', () => {
  it('keeps static lines and isolates identical IDs by mode and source', async () => {
    const city = await liveCity();
    try {
      await city.collect([...LIVE_DEFINITIONS, ...OTHER_SOURCES.lirr, ...OTHER_SOURCES.metroNorth]);
      const response = await city.app.request('/api/live/lines');
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        lines: { mode: string; sourceId: string; lineId: string; vehicleCount: number }[];
      };
      const all = body.lines.filter((line) => line.lineId === '1');
      expect(
        all.some((line) => line.mode === 'subway' && line.sourceId === 'mta-subway-1234567'),
      ).toBe(true);
      expect(
        all.some((line) => line.mode === 'rail' && line.sourceId === 'mta-lirr-realtime'),
      ).toBe(true);
      expect(
        all.some((line) => line.mode === 'rail' && line.sourceId === 'mta-metro-north-realtime'),
      ).toBe(true);
      expect(body.lines.some((line) => line.vehicleCount === 0)).toBe(true);
    } finally {
      await city.dispose();
    }
  }, 60000);

  it('filters only selected line identities, preserves default and validates input', async () => {
    const city = await liveCity();
    try {
      await city.collect([
        ...LIVE_DEFINITIONS,
        ...OTHER_SOURCES.lirr,
        ...OTHER_SOURCES.metroNorth,
        ...OTHER_SOURCES.air,
      ]);
      const url = '/api/live/vehicles';
      const all = (await (await city.app.request(url)).json()) as {
        vehicles: { mode: string; sourceId: string; line: { id: string } | null }[];
      };
      expect(all.vehicles.length).toBeGreaterThan(0);
      const empty = (await (await city.app.request(`${url}?lines=%5B%5D`)).json()) as typeof all;
      expect(empty.vehicles).toHaveLength(0);
      const active = all.vehicles.find(
        (vehicle) => vehicle.mode === 'bus' && vehicle.line !== null,
      );
      if (active?.line === null || active === undefined) throw new Error('No captured bus');
      const key = [{ mode: 'bus', sourceId: active.sourceId, lineId: active.line.id }];
      const query = new URLSearchParams({ modes: 'bus,aircraft', lines: JSON.stringify(key) });
      const selected = (await (
        await city.app.request(`${url}?${query.toString()}`)
      ).json()) as typeof all;
      expect(selected.vehicles.length).toBeGreaterThan(0);
      expect(
        selected.vehicles.every(
          (vehicle) =>
            vehicle.mode === 'aircraft' ||
            (vehicle.sourceId === key[0]?.sourceId && vehicle.line?.id === active.line?.id),
        ),
      ).toBe(true);
      expect((await city.app.request(`${url}?lines=bad`)).status).toBe(400);
    } finally {
      await city.dispose();
    }
  }, 60000);
  it('allows only explicitly enabled non-line modes with an empty line selection', async () => {
    const city = await liveCity(undefined, '2026-11-11T02:52:40.000Z');
    try {
      await city.collect(OTHER_SOURCES.air);
      const query = new URLSearchParams({ modes: 'aircraft', lines: '[]' });
      const body = (await (
        await city.app.request(`/api/live/vehicles?${query.toString()}`)
      ).json()) as { vehicles: { mode: string }[] };
      expect(body.vehicles.length).toBeGreaterThan(0);
      expect(body.vehicles.every((vehicle) => vehicle.mode === 'aircraft')).toBe(true);
    } finally {
      await city.dispose();
    }
  }, 60000);
  it('lists published Passio routes even when no shuttle runs on them', async () => {
    const city = await liveCity(undefined, '2026-11-11T03:20:10.000Z');
    try {
      await city.collect([...OTHER_SOURCES.shuttles, passioRouteSource]);
      const body = (await (await city.app.request('/api/live/lines')).json()) as {
        lines: { sourceId: string; lineId: string; name: string; vehicleCount: number }[];
      };
      expect(
        body.lines.some(
          (line) =>
            line.sourceId === 'passio-go-shuttles' &&
            line.vehicleCount === 0 &&
            line.name !== line.lineId,
        ),
      ).toBe(true);
    } finally {
      await city.dispose();
    }
  }, 60000);
});
