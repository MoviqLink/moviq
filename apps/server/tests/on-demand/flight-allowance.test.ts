import type { Flight } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { Secret } from '../../src/config/secret.js';
import { createAeroDataBoxFlights } from '../../src/modules/data-platform/on-demand/aerodatabox.js';
import {
  createUnitAllowance,
  FLIGHT_STATUS_UNITS,
  MONTHLY_UNITS,
  RESERVED_UNITS,
} from '../../src/modules/data-platform/on-demand/aerodatabox-units.js';
import { cachedFlights, keepFor } from '../../src/modules/data-platform/on-demand/flight-cache.js';
import type { FlightFinder, ProviderOutcome } from '../../src/modules/journeys/ports.js';
import { manualClock } from '../support/manual-clock.js';
import { capture, fixedClock, stubHttp } from './support.js';

const query = { carrier: 'AA', number: '100', date: '2026-11-10' };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The headers RapidAPI sent with the capture (`aerodatabox-flight-aa100.headers.txt`). */
const gateway = (remaining: number) => ({
  'x-tier': 'Tier 2',
  'x-ratelimit-api-units-limit': '400',
  'x-ratelimit-api-units-remaining': String(remaining),
  'x-ratelimit-api-units-reset': '2591227',
});

describe("AeroDataBox's monthly units", () => {
  it('counts 2 units per Flight Status request and keeps 40 of the 400 in reserve', () => {
    expect([FLIGHT_STATUS_UNITS, MONTHLY_UNITS, RESERVED_UNITS]).toEqual([2, 400, 40]);
    expect(capture('aerodatabox-flight-aa100.headers.txt')).toContain('x-tier: Tier 2');
    const units = createUnitAllowance();
    const now = new Date('2026-11-11T04:00:00Z');
    expect(units.spendable(now)).toBe(360);
    let requests = 0;
    while (units.take(FLIGHT_STATUS_UNITS, now)) requests += 1;
    expect(requests).toBe(180);
    expect(units.spendable(now)).toBe(0);
  });

  it('refuses without sending once only the reserve is left, and says so', async () => {
    const { http, sent } = stubHttp({ body: capture('aerodatabox-flight-aa100.json') });
    const flights = createAeroDataBoxFlights({
      http,
      clock: fixedClock('2026-11-11T03:51:37Z'),
      credential: { key: new Secret('test-key') },
      units: createUnitAllowance(46, 40),
      spacingMs: 0,
    });
    for (let request = 0; request < 3; request += 1) {
      expect((await flights.find(query)).ok).toBe(true);
    }
    const refused = await flights.find(query);
    expect(sent).toHaveLength(3);
    expect(refused).toEqual({
      ok: false,
      state: 'rate_limited',
      code: 'monthly-units',
      detail:
        "AeroDataBox's free plan has 0 of its 400 monthly units left above the reserve: flights " +
        'are not looked up until it renews.',
    });
  });

  it("trusts the gateway's count, shared by every process, and restarts with its month", async () => {
    const { http, sent } = stubHttp({
      body: capture('aerodatabox-flight-aa100.json'),
      headers: gateway(41),
    });
    const clock = manualClock('2026-11-11T03:51:37Z');
    const units = createUnitAllowance();
    const flights = createAeroDataBoxFlights({
      http,
      clock,
      credential: { key: new Secret('test-key') },
      units,
      spacingMs: 0,
    });
    expect((await flights.find(query)).ok).toBe(true);
    expect(units.spendable(clock.now())).toBe(1);
    expect(await flights.find(query)).toMatchObject({ ok: false, code: 'monthly-units' });
    expect(sent).toHaveLength(1);
    // Once the gateway's month restarts, what was spent before it no longer counts.
    clock.advance(2_591_227_000);
    expect(units.spendable(clock.now())).toBe(360);
  });

  it('ignores a gateway answer without the count', () => {
    const units = createUnitAllowance();
    const now = new Date('2026-11-11T04:00:00Z');
    units.observe(new Headers({ 'x-ratelimit-api-units-remaining': 'many' }), now);
    units.observe(new Headers(), now);
    expect(units.spendable(now)).toBe(360);
  });

  it('sends one request a second at most, even when asked at once', async () => {
    const { http, sent } = stubHttp({ body: '[]' });
    const flights = createAeroDataBoxFlights({
      http,
      clock: fixedClock('2026-11-11T03:51:37Z'),
      credential: { key: new Secret('test-key') },
      units: createUnitAllowance(),
      spacingMs: 120,
    });
    const started = Date.now();
    await Promise.all([flights.find(query), flights.find({ ...query, date: '2026-11-11' })]);
    expect(sent).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(115);
  });
});

function flight(departureAt: string, overrides: Partial<Flight> = {}): Flight {
  return {
    carrier: 'AA',
    number: '100',
    departureAt,
    revisedDeparture: null,
    takeOffAt: null,
    airport: 'JFK',
    terminal: '8',
    gate: null,
    status: 'Expected',
    aircraftHex: null,
    callSign: 'AAL100',
    provenance: {
      sourceId: 'aerodatabox',
      dataTime: '2026-11-11T12:00:00.000Z',
      receivedAt: '2026-11-11T12:00:00.000Z',
      ageSeconds: 0,
      state: 'healthy',
      evidence: 'Test flight.',
    },
    ...overrides,
  };
}

const found = (value: Flight | null): ProviderOutcome<Flight | null> => ({
  ok: true,
  value,
  provenance: value?.provenance ?? flight('2026-11-11T20:00:00.000Z').provenance,
});

describe('the flight cache', () => {
  const now = new Date('2026-11-11T12:00:00.000Z');

  it('keeps an answer longer far from the departure, 20 minutes in the 3 hours before it', () => {
    expect(keepFor(found(flight('2026-11-12T12:00:00.000Z')), now)).toBe(3 * HOUR);
    expect(keepFor(found(flight('2026-11-11T16:00:00.000Z')), now)).toBe(HOUR);
    expect(keepFor(found(flight('2026-11-11T14:00:00.000Z')), now)).toBe(20 * MINUTE);
    const revised = flight('2026-11-11T17:00:00.000Z', {
      revisedDeparture: { at: '2026-11-11T14:30:00.000Z', kind: 'revised' },
    });
    expect(keepFor(found(revised), now)).toBe(20 * MINUTE);
    const left = flight('2026-11-11T11:00:00.000Z', { takeOffAt: '2026-11-11T11:20:00.000Z' });
    expect(keepFor(found(left), now)).toBe(3 * HOUR);
    expect(keepFor(found(null), now)).toBe(3 * HOUR);
    const down = { ok: false, state: 'unavailable', code: 'timeout', detail: 'Slow.' } as const;
    expect(keepFor(down, now)).toBe(5 * MINUTE);
  });

  it('serves a kept answer with its age worked out again, and asks again once it is due', async () => {
    const clock = manualClock('2026-11-11T12:00:00.000Z');
    let asked = 0;
    const inner: FlightFinder = {
      sourceId: 'aerodatabox',
      find: () => {
        asked += 1;
        return Promise.resolve(found(flight('2026-11-11T14:00:00.000Z')));
      },
    };
    const flights = cachedFlights(inner, clock);
    await flights.find(query);
    clock.advance(4 * MINUTE);
    const kept = await flights.find(query);
    expect(asked).toBe(1);
    expect(kept).toMatchObject({ ok: true, provenance: { ageSeconds: 240 } });
    expect(kept.ok && kept.value?.provenance.ageSeconds).toBe(240);
    await flights.find({ ...query, date: '2026-11-11' });
    expect(asked).toBe(2);
    clock.advance(17 * MINUTE);
    await flights.find(query);
    expect(asked).toBe(3);
  });
});
