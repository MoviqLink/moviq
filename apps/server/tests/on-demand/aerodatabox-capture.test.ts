import { describe, expect, it } from 'vitest';

import { Secret } from '../../src/config/secret.js';
import { createAeroDataBoxFlights } from '../../src/modules/data-platform/on-demand/aerodatabox.js';
import { createUnitAllowance } from '../../src/modules/data-platform/on-demand/aerodatabox-units.js';
import { capture, fixedClock, stubHttp } from './support.js';

/**
 * The answer written for the tests in the documented shape, read at 03:51:37 UTC on 11/11/2026,
 * optionally edited as a test needs.
 */
async function read(edit: (body: string) => string = (body) => body, at = '2026-11-11T03:51:37Z') {
  const { http } = stubHttp({ body: edit(capture('aerodatabox-flight-aa100.json')) });
  const flights = createAeroDataBoxFlights({
    http,
    clock: fixedClock(at),
    credential: { key: new Secret('test-key') },
    units: createUnitAllowance(),
    spacingMs: 0,
  });
  return flights.find({ carrier: 'AA', number: '100', date: '2026-11-10' });
}

describe("AeroDataBox's answer for one flight", () => {
  it('reads AA 100 of 10/11/2026: revised time, take-off, call sign and aircraft', async () => {
    expect(await read()).toEqual({
      ok: true,
      value: {
        carrier: 'AA',
        number: '100',
        departureAt: '2026-11-10T23:20:00.000Z',
        revisedDeparture: { at: '2026-11-10T23:30:00.000Z', kind: 'revised' },
        takeOffAt: '2026-11-10T23:44:00.000Z',
        airport: 'JFK',
        terminal: '8',
        gate: null,
        status: 'EnRoute',
        callSign: 'AAL100',
        aircraftHex: 'a00001',
        provenance: {
          sourceId: 'aerodatabox',
          dataTime: '2026-11-10T23:50:00.000Z',
          receivedAt: '2026-11-11T03:51:37.000Z',
          ageSeconds: 14497,
          state: 'healthy',
          evidence: 'AeroDataBox lists AA 100 departing JFK on 2026-11-10.',
        },
      },
      provenance: expect.objectContaining({ sourceId: 'aerodatabox' }) as unknown,
    });
  });

  it('keeps a runway time as a take-off only once passed and the flight has left', async () => {
    const boarding = await read((body) =>
      body.replace('"status": "EnRoute"', '"status": "Boarding"'),
    );
    expect(boarding).toMatchObject({ ok: true, value: { takeOffAt: null } });
    const before = await read(undefined, '2026-11-10T23:40:00Z');
    expect(before).toMatchObject({ ok: true, value: { takeOffAt: null } });
  });
});
