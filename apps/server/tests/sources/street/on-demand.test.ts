import { provenanceSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  createParkingSignsReader,
  createPermitStipulationsReader,
} from '../../../src/modules/data-platform/sources/street/index.js';
import {
  fromStatePlane,
  toStatePlane,
} from '../../../src/modules/data-platform/sources/street/state-plane.js';
import { fixedClock, stubHttp } from '../../on-demand/support.js';
import { captureJson } from '../ny511/captures.js';

const body = (name: string) => JSON.stringify(captureJson('street', name));

/** Meters of the capture, which give both their state-plane feet and their latitude and longitude. */
const meters = z
  .array(
    z.object({
      meter_number: z.string(),
      lat: z.string(),
      long: z.string(),
      x: z.string(),
      y: z.string(),
    }),
  )
  .parse(captureJson('street', 'parking-meters.json'));

describe('NAD83 / New York Long Island (EPSG:2263)', () => {
  it.each(meters.map((meter) => [meter.meter_number, meter] as const))(
    'places meter %s where the city does, both ways',
    (_, meter) => {
      const point = fromStatePlane({ x: Number(meter.x), y: Number(meter.y) });
      expect(point.lat).toBeCloseTo(Number(meter.lat), 7);
      expect(point.lon).toBeCloseTo(Number(meter.long), 7);
      const feet = toStatePlane({ lat: Number(meter.lat), lon: Number(meter.long) });
      expect(feet.x).toBeCloseTo(Number(meter.x), 2);
      expect(feet.y).toBeCloseTo(Number(meter.y), 2);
    },
  );
});

describe('NYC parking regulation signs, by tile', () => {
  const clock = fixedClock('2026-11-11T04:44:36Z');
  /** 10 Av and W 57 St, the place of the first meter of the capture. */
  const tenthAvenue = { lat: 40.7695407107263, lon: -73.9883702549362 };

  it('asks the current signs of the tile around a point and shows each with its text', async () => {
    const { http, sent } = stubHttp({ body: body('parking-signs-tile.json') });
    const outcome = await createParkingSignsReader({ http, clock }).near(tenthAvenue);
    if (!outcome.ok) throw new Error(outcome.detail);
    const where = decodeURIComponent(sent[0]?.url ?? '');
    expect(where).toContain(
      "record_type='Current' AND sign_x_coord>=987000 AND sign_x_coord<988000",
    );
    expect(where).toContain('sign_y_coord>=219000 AND sign_y_coord<220000');
    expect(outcome.value.tile).toEqual({ column: 987, row: 219 });
    expect(outcome.value.signs).toHaveLength(157);
    expect(outcome.value.signs[0]).toMatchObject({
      order: 'P-01312838',
      street: '10 AVENUE',
      from: 'WEST 55 STREET',
      code: 'PS-214C',
      text: '2 HMP MONDAY-FRIDAY 10AM-4PM SATURDAY 9AM-7PM <->',
      since: '2018-10-20',
    });
    expect(outcome.value.signs[0]?.point.lat).toBeCloseTo(40.7681, 3);
    expect(provenanceSchema.parse(outcome.provenance)).toMatchObject({
      dataTime: null,
      sourceId: 'nyc-parking-signs',
    });
  });

  it('keeps a tile a day, and never takes a cut answer for the whole tile', async () => {
    const { http, sent } = stubHttp({ body: body('parking-signs-tile.json') });
    const reader = createParkingSignsReader({ http, clock });
    await reader.near(tenthAvenue);
    await reader.near({ lat: tenthAvenue.lat + 0.0001, lon: tenthAvenue.lon });
    expect(sent).toHaveLength(1);
    const rows = z.array(z.unknown()).parse(captureJson('street', 'parking-signs-tile.json'));
    const full = stubHttp({ body: JSON.stringify(Array.from({ length: 5_000 }, () => rows[0])) });
    expect(
      await createParkingSignsReader({ http: full.http, clock }).near(tenthAvenue),
    ).toMatchObject({
      ok: false,
      code: 'too-many-rows',
    });
  });

  it('says the provider failed when it is down', async () => {
    const { http } = stubHttp('network-down');
    expect(await createParkingSignsReader({ http, clock }).near(tenthAvenue)).toMatchObject({
      ok: false,
      state: 'unavailable',
      code: 'network',
    });
  });
});

describe('Stipulations of a street permit', () => {
  const clock = fixedClock('2026-11-11T04:35:06Z');

  it('lists the standard conditions of one permit, dated by the newest', async () => {
    const { http, sent } = stubHttp({ body: body('permit-stipulations.json') });
    const reader = createPermitStipulationsReader({ http, clock });
    const outcome = await reader.forPermit('B022026282B47');
    if (!outcome.ok) throw new Error(outcome.detail);
    expect(outcome.value.stipulations.map((stipulation) => stipulation.id)).toEqual([
      '027',
      '038',
      '066',
      '078',
      '087',
      '091',
      '103',
      'HIQA01',
      'NOISE1',
      'SCHOOL',
      'TMC001',
    ]);
    expect(outcome.provenance.dataTime).toBe('2026-10-09T16:06:31.000Z');
    expect(new URL(sent[0]?.url ?? '').searchParams.get('permitnumber')).toBe('B022026282B47');
    await reader.forPermit('B022026282B47');
    expect(sent).toHaveLength(1);
  });

  it('asks nothing for what is not a permit number', async () => {
    const { http, sent } = stubHttp({ body: '[]' });
    const outcome = await createPermitStipulationsReader({ http, clock }).forPermit("x' OR 1=1");
    expect(outcome).toMatchObject({ ok: false, state: 'misconfigured', code: 'bad-query' });
    expect(sent).toHaveLength(0);
  });
});
