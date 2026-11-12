import { describe, expect, it } from 'vitest';

import { passioRouteSource } from '../../src/modules/data-platform/sources/shuttles/passio-routes.js';
import { createSourceReader } from '../../src/modules/data-platform/reader.js';
import { place } from '../../src/modules/live/estimation/line.js';
import { selectedOtherRoute } from '../../src/modules/live/selected-other-routes.js';
import { createTimetables, timetableSources } from '../../src/modules/live/timetable.js';
import { liveCity, OTHER_SOURCES } from './city.js';

describe('selected ferry route', () => {
  it('joins each captured boat to its own trip shape, and refuses another route or source', async () => {
    const city = await liveCity(undefined, '2026-11-11T02:28:00.000Z');
    try {
      await city.collect(OTHER_SOURCES.nycFerry);
      const reader = createSourceReader({
        db: city.db,
        clock: city.clock,
        missingVariables: () => [],
      });
      const tables = await createTimetables(reader, city.clock).current();
      const boats = (await city.live.snapshot()).vehicles.filter((item) => item.mode === 'ferry');
      expect(boats).toHaveLength(4);
      for (const boat of boats) {
        const line = await selectedOtherRoute(boat, reader, tables);
        expect(line?.points.length).toBeGreaterThan(1);
        expect(line && place(line, boat.position).offsetMeters).toBeLessThan(100);
        expect(
          await selectedOtherRoute(
            { ...boat, line: { id: 'wrong', name: 'wrong', longName: null } },
            reader,
            tables,
          ),
        ).toBeUndefined();
        expect(
          await selectedOtherRoute({ ...boat, sourceId: 'wrong' }, reader, tables),
        ).toBeUndefined();
      }
    } finally {
      await city.dispose();
    }
  }, 60000);
});

it('matches the captured Newark shuttles to their exact trips and shapes', async () => {
  const city = await liveCity(undefined, '2026-11-11T03:20:10.000Z');
  try {
    await city.collect([...OTHER_SOURCES.shuttles, ...timetableSources.newarkShuttle]);
    const reader = createSourceReader({
      db: city.db,
      clock: city.clock,
      missingVariables: () => [],
    });
    const tables = await createTimetables(reader, city.clock).current();
    const buses = (await city.live.snapshot()).vehicles.filter(
      (item) => item.sourceId === 'ewr-shuttle-positions',
    );
    expect(buses).toHaveLength(17);
    const offsets: number[] = [];
    for (const bus of buses) {
      const line = await selectedOtherRoute(bus, reader, tables);
      expect(line?.points.length).toBeGreaterThan(1);
      if (line !== undefined) offsets.push(place(line, bus.position).offsetMeters);
    }
    expect(offsets.filter((offset) => offset <= 100).length).toBe(16);
    expect(offsets).toHaveLength(17);
    const first = buses[0];
    if (first === undefined) throw new Error('No captured Newark bus');
    expect(
      await selectedOtherRoute({ ...first, tripId: 'missing' }, reader, tables),
    ).toBeUndefined();
  } finally {
    await city.dispose();
  }
}, 60000);

it('draws the public Passio GO shape belonging to each selected route', async () => {
  const city = await liveCity(undefined, '2026-11-11T03:20:10.000Z');
  try {
    await city.collect([...OTHER_SOURCES.shuttles, passioRouteSource]);
    const reader = createSourceReader({
      db: city.db,
      clock: city.clock,
      missingVariables: () => [],
    });
    const tables = await createTimetables(reader, city.clock).current();
    const buses = (await city.live.snapshot()).vehicles.filter(
      (item) => item.sourceId === 'passio-go-shuttles',
    );
    const covered = await Promise.all(buses.map((bus) => selectedOtherRoute(bus, reader, tables)));
    expect(buses.length).toBeGreaterThan(0);
    expect(covered.filter(Boolean).length).toBeGreaterThan(0);
    const bus = buses[0];
    if (bus === undefined) throw new Error('No captured Passio bus');
    expect(
      await selectedOtherRoute(
        { ...bus, line: { id: 'missing', name: 'missing', longName: null } },
        reader,
        tables,
      ),
    ).toBeUndefined();
  } finally {
    await city.dispose();
  }
}, 60000);
