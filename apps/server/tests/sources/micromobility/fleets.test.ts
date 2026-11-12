import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { freeVehiclesSchema } from '../../../src/modules/data-platform/sources/micromobility/free-vehicles.js';
import { micromobilitySources } from '../../../src/modules/data-platform/sources/micromobility/index.js';
import {
  accepted,
  capture,
  captureJson,
  findSource,
  json,
  storedAndRead,
  text,
} from '../regional/captures.js';

/** The captures were downloaded between 03:20:44 and 03:20:56 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:21:00Z');

/** Loose, so the fields not changed (`ttl`, `version`) stay as captured. */
const envelopeSchema = z.looseObject({
  last_updated: z.number(),
  data: z.looseObject({ bikes: z.array(z.record(z.string(), z.unknown())) }),
});

function parse(id: string, body: Uint8Array, previous?: unknown) {
  return findSource(micromobilitySources, id).parse(body, { receivedAt: RECEIVED_AT, previous });
}

function read(id: string, file: string) {
  const result = accepted(parse(id, capture('micromobility', file)));
  expect(storedAndRead(findSource(micromobilitySources, id), result.data)).toEqual(result.data);
  return { result, data: freeVehiclesSchema.parse(result.data) };
}

/** The Lime capture with its envelope or rows changed. */
function lime(change: (answer: z.infer<typeof envelopeSchema>) => void): Uint8Array {
  const answer = envelopeSchema.parse(captureJson('micromobility', 'lime-new-york.json'));
  change(answer);
  return json(answer);
}

describe('Shared vehicles parked in the street (GBFS)', () => {
  it('accepts Lime: scooters with ids that change on every answer', () => {
    const { result, data } = read('lime-new-york', 'lime-new-york.json');
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:20:45.000Z');
    expect(result.coverage).toBe('8 vehicles, 8 ready to rent, 0 left out');
    expect(data.vehicleIds).toBe('rotating');
    expect(data.vehicles[0]).toMatchObject({
      located: 'parked',
      kind: 'scooter',
      rangeMetres: 12489,
      battery: null,
      reportedAt: '2026-11-11T03:20:28.000Z',
    });
  });

  it('accepts Veo in the Bronx and Queens: stable ids, e-bikes and scooters, no report time', () => {
    const bronx = read('veo-bronx', 'veo-bronx.json');
    expect(bronx.result.coverage).toBe('12 vehicles, 10 ready to rent, 0 left out');
    expect(bronx.data.vehicleIds).toBe('stable');
    expect(bronx.data.vehicles.map((vehicle) => vehicle.kind)).toEqual([
      ...Array<string>(8).fill('e-bike'),
      'scooter',
      'e-bike',
      'scooter',
      'scooter',
    ]);
    expect(bronx.data.vehicles.every((vehicle) => vehicle.reportedAt === null)).toBe(true);
    const queens = read('veo-queens', 'veo-queens.json');
    expect(queens.result.dataTime.toISOString()).toBe('2026-11-11T03:20:53.000Z');
    expect(queens.result.coverage).toBe('10 vehicles, 8 ready to rent, 0 left out');
  });

  it('accepts Bird: scooters with their battery and their own report time', () => {
    const { result, data } = read('bird-new-york', 'bird-new-york.json');
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:59.000Z');
    expect(result.coverage).toBe('9 vehicles, 8 ready to rent, 0 left out');
    expect(data.vehicleIds).toBe('rotating');
    expect(data.vehicles[0]).toMatchObject({
      kind: 'scooter',
      battery: 0.16129032,
      reportedAt: '2026-11-11T03:18:01.000Z',
    });
  });

  it('leaves out a row without a place, and keeps a vehicle of an unlisted type as unknown', () => {
    const body = lime((answer) => {
      const [first, second] = answer.data.bikes;
      if (first === undefined || second === undefined) throw new Error('short capture');
      delete first['lat'];
      second['vehicle_type_id'] = '9';
    });
    const result = accepted(parse('lime-new-york', body));
    expect(result.coverage).toBe('7 vehicles, 7 ready to rent, 1 left out');
    expect(freeVehiclesSchema.parse(result.data).vehicles[0]?.kind).toBeNull();
  });

  it.each([
    ['not-json', text('<html>Just a moment...</html>')],
    ['unexpected-shape', json({ last_updated: 1794367245, data: {} })],
    [
      'future-update',
      lime((answer) => {
        answer.last_updated += 600;
      }),
    ],
    [
      'no-vehicles',
      lime((answer) => {
        answer.data.bikes = [];
      }),
    ],
  ])('refuses %s', (code, body) => {
    expect(parse('lime-new-york', body)).toMatchObject({ ok: false, code });
  });

  it('refuses a file older than the one served, or with under half its vehicles', () => {
    const source = findSource(micromobilitySources, 'veo-bronx');
    const served = accepted(parse('veo-bronx', capture('micromobility', 'veo-bronx.json'))).data;
    const queens = accepted(parse('veo-queens', capture('micromobility', 'veo-queens.json'))).data;
    expect(source.check?.(served, queens)).toEqual([
      'older-than-served: the candidate is from 2026-11-11T03:20:49.000Z, ' +
        'the served data from 2026-11-11T03:20:53.000Z',
    ]);
    const cut = freeVehiclesSchema.parse(served);
    const fewer = {
      ...cut,
      updatedAt: '2026-11-11T03:25:00.000Z',
      vehicles: cut.vehicles.slice(7),
    };
    expect(source.check?.(fewer, served)).toEqual(['coverage-drop: 5 vehicles, 12 before']);
  });

  it('downloads the free_bike_status file of each system, without a key', () => {
    const urls = micromobilitySources.map(
      (source) => source.request({ credentials: {}, now: RECEIVED_AT }).url,
    );
    expect(urls).toEqual([
      'https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status',
      'https://cluster-prod.veoride.com/api/shares/name/nyc/gbfs/free_bike_status',
      'https://cluster-prod.veoride.com/api/shares/name/nyq/gbfs/free_bike_status',
      'https://mds.bird.co/gbfs/v2/public/new-york/free_bike_status.json',
    ]);
  });
});
