import { scheduledFlightSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  FIDS_UNITS,
  fidsUrl,
  readSnapshot,
} from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import { capture } from '../on-demand/support.js';
import { BOARD_TAKEN_AT, jfkSnapshot } from './support.js';

const nodeSchema = z.object({
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  enum: z.array(z.string()).optional(),
});

/** The official OpenAPI 1.15.4.0, cut to the FIDS operation and the schemas it answers with. */
const spec = z
  .object({
    info: z.object({ version: z.string() }),
    paths: z.record(
      z.string(),
      z.object({
        get: z.object({
          summary: z.string(),
          parameters: z.array(z.object({ name: z.string() })),
        }),
      }),
    ),
    components: z.object({ schemas: z.record(z.string(), nodeSchema) }),
  })
  .parse(JSON.parse(capture('aerodatabox-openapi-fids.json')));

function documented(name: string) {
  const found = spec.components.schemas[name];
  if (found === undefined) throw new Error(`${name} is not in the official schema`);
  return { ...found, properties: Object.keys(found.properties ?? {}) };
}

const read = (body: string) =>
  readSnapshot(
    { status: 200, body: new TextEncoder().encode(body), receivedAt: BOARD_TAKEN_AT },
    'JFK',
  );

describe("AeroDataBox's FIDS, the airport board", () => {
  it('asks the documented relative window, both directions, in one Tier 2 request', () => {
    const headers = capture('aerodatabox-fids-kjfk.headers.txt');
    expect(headers).toContain(`GET ${fidsUrl('JFK')}`);
    expect(headers).toContain('x-tier: Tier 2');
    expect(headers).toContain('x-ratelimit-api-units-remaining: 394');
    expect(FIDS_UNITS).toBe(2);
    expect(fidsUrl('EWR')).toBe(
      'https://aerodatabox.p.rapidapi.com/flights/airports/icao/KEWR?offsetMinutes=-120' +
        '&durationMinutes=720&direction=Both&withLeg=true&withCodeshared=false&withCargo=false' +
        '&withPrivate=false',
    );
    const operation = spec.paths['/flights/airports/{codeType}/{code}']?.get;
    expect(spec.info.version).toBe('1.15.4.0');
    expect(operation?.summary).toContain('TIER 2');
    expect(operation?.parameters.map((parameter) => parameter.name)).toEqual(
      expect.arrayContaining(['offsetMinutes', 'durationMinutes', 'direction', 'withLeg']),
    );
  });

  it('reads only fields the official schema documents', () => {
    expect(documented('AirportFidsContract').properties).toEqual(['departures', 'arrivals']);
    const flight = documented('AirportFlightContract');
    expect(flight.properties).toEqual(
      expect.arrayContaining(['departure', 'arrival', 'number', 'callSign', 'status', 'airline']),
    );
    expect(flight.required).toEqual(expect.arrayContaining(['number', 'status', 'isCargo']));
    expect(documented('FlightAirportMovementContract').properties).toEqual(
      expect.arrayContaining([
        'airport',
        'scheduledTime',
        'revisedTime',
        'runwayTime',
        'terminal',
        'gate',
        'quality',
      ]),
    );
    expect(documented('FlightAirportMovementQualityEnum').enum).toContain('Live');
    expect(documented('FlightStatus').enum).toEqual([
      'Unknown',
      'Expected',
      'EnRoute',
      'CheckIn',
      'Boarding',
      'GateClosed',
      'Departed',
      'Delayed',
      'Approaching',
      'Arrived',
      'Canceled',
      'Diverted',
      'CanceledUncertain',
    ]);
  });

  it('reads the JFK board of the tests whole, each flight in the public contract', () => {
    const board = jfkSnapshot();
    expect([board.departures.length, board.arrivals.length]).toEqual([14, 9]);
    expect(board.window).toEqual({
      from: new Date('2026-11-11T03:39:49Z'),
      to: new Date('2026-11-11T15:39:49Z'),
    });
    for (const flight of [...board.departures, ...board.arrivals]) {
      expect(scheduledFlightSchema.parse(JSON.parse(JSON.stringify(flight)))).toEqual(flight);
    }
    const times = board.departures.map((flight) => Date.parse(flight.scheduledAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(board.departures.find((flight) => flight.number === 'T1 16')).toMatchObject({
      id: 'T1 16@2026-11-11T03:50:00.000Z',
      airline: { name: 'Test Air One', iata: 'T1', icao: 'TTA' },
      callSign: 'TTA16',
      airport: { name: 'Reykjavik', iata: 'KEF', icao: 'BIKF' },
      revisedAt: '2026-11-11T03:48:00.000Z',
      runway: { at: '2026-11-11T04:02:00.000Z', kind: 'actual' },
      terminal: '7',
      gate: null,
      status: 'Departed',
      basis: 'live',
      provenance: { sourceId: 'aerodatabox', dataTime: '2026-11-11T05:39:49.000Z' },
    });
    expect(board.arrivals.find((flight) => flight.number === 'T2 526')).toMatchObject({
      airport: { name: 'Kingston', iata: 'KIN' },
      runway: { at: '2026-11-11T03:37:00.000Z', kind: 'actual' },
      status: 'Arrived',
    });
  });

  it('keeps what the board gives as it is: no gates at JFK, a repeated number', () => {
    const board = jfkSnapshot();
    expect([...board.departures, ...board.arrivals].some((flight) => flight.gate !== null)).toBe(
      false,
    );
    const repeated = board.departures.filter((flight) => flight.number === 'T3 4007');
    expect(repeated.map((flight) => flight.id)).toEqual([
      'T3 4007@2026-11-11T03:50:00.000Z',
      'T3 4007@2026-11-11T04:21:00.000Z',
    ]);
    expect(board.arrivals.find((flight) => flight.number === 'T4 12')).toMatchObject({
      status: 'CanceledUncertain',
      callSign: null,
    });
  });

  it("serves AeroDataBox's Unknown status as no status", () => {
    const outcome = read(
      JSON.stringify({
        departures: [
          {
            departure: {
              scheduledTime: { utc: '2026-11-11 06:00Z', local: '2026-11-11 01:00-05:00' },
              quality: ['Basic'],
            },
            arrival: { airport: { iata: 'LAX', name: 'Los Angeles' }, quality: ['Basic'] },
            number: 'AA  2694',
            status: 'Unknown',
            codeshareStatus: 'IsOperator',
            isCargo: false,
          },
        ],
      }),
    );
    expect(outcome.ok && outcome.value.departures[0]).toMatchObject({
      number: 'AA 2694',
      status: null,
      basis: 'timetable',
    });
  });

  it('says a runway time is an estimate until it has passed for a flight that has left', () => {
    const body = JSON.stringify({
      departures: [
        {
          departure: {
            scheduledTime: { utc: '2026-11-11 06:00Z', local: '2026-11-11 01:00-05:00' },
            runwayTime: { utc: '2026-11-11 06:20Z', local: '2026-11-11 01:20-05:00' },
            quality: ['Basic', 'Live'],
          },
          arrival: { airport: { iata: 'LAX', name: 'Los Angeles' }, quality: ['Basic'] },
          number: 'AA 1',
          status: 'Expected',
          codeshareStatus: 'IsOperator',
          isCargo: false,
        },
      ],
      arrivals: null,
    });
    const outcome = read(body);
    expect(outcome.ok && outcome.value.departures[0]?.runway).toEqual({
      at: '2026-11-11T06:20:00.000Z',
      kind: 'estimated',
    });
  });

  it('leaves out an entry it cannot read, a cargo flight and one without a time or other end', () => {
    const entry = (extra: Record<string, unknown>) => ({
      departure: {
        scheduledTime: { utc: '2026-11-11 06:00Z', local: '2026-11-11 01:00-05:00' },
        quality: ['Basic'],
      },
      arrival: { airport: { iata: 'LAX', name: 'Los Angeles' }, quality: ['Basic'] },
      number: 'AA 1',
      status: 'Expected',
      codeshareStatus: 'IsOperator',
      isCargo: false,
      ...extra,
    });
    const outcome = read(
      JSON.stringify({
        departures: [
          entry({}),
          entry({ number: 'FX 9', isCargo: true }),
          entry({ number: 'AA 2', arrival: { quality: ['Basic'] } }),
          entry({ number: 'AA 3', departure: { quality: ['Basic'] } }),
          { number: 7 },
        ],
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      provenance: {
        evidence: 'AeroDataBox listed 1 departures and 0 arrivals at JFK, 4 left out.',
      },
    });
  });

  it('refuses a body that is not JSON, and one that is not a board', () => {
    expect(read('<html>Bad gateway</html>')).toMatchObject({ ok: false, code: 'not-json' });
    expect(read('{"departures": 3}')).toMatchObject({ ok: false, code: 'unexpected-shape' });
  });
});
