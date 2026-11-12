import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { shuttleSources } from '../../../src/modules/data-platform/sources/shuttles/index.js';
import {
  instantOfClock,
  passioGoSchema,
} from '../../../src/modules/data-platform/sources/shuttles/passio-go.js';
import {
  accepted,
  capture,
  captureJson,
  findSource,
  json,
  storedAndRead,
  text,
} from '../regional/captures.js';

const passioGo = findSource(shuttleSources, 'passio-go-shuttles');
/** The capture was downloaded at 03:22:15 UTC on 11/11/2026 (22:22 in New York). */
const RECEIVED_AT = new Date('2026-11-11T03:22:20Z');

const answerSchema = z.object({
  buses: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  time: z.record(z.string(), z.string()),
});

function parse(body: Uint8Array) {
  return passioGo.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

/** The capture with the first bus of NYU changed by `change`. */
function withFirstBus(change: Record<string, unknown>): Uint8Array {
  const answer = answerSchema.parse(captureJson('shuttles', 'passio-go-buses.json'));
  const [first] = Object.values(answer.buses);
  const [bus] = first ?? [];
  if (bus === undefined) throw new Error('the capture has no bus');
  Object.assign(bus, change);
  return json(answer);
}

describe('Passio GO shuttles (NYU, LIU, Downtown Connection, Hutch, Hoboken)', () => {
  it('accepts the capture: five NYU buses with a passenger count and one LIU bus without', () => {
    const result = accepted(parse(capture('shuttles', 'passio-go-buses.json')));
    // 10:22 PM in New York on 10/11/2026, to the minute.
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:22:00.000Z');
    expect(result.coverage).toBe('6 shuttles, 5 with a passenger count, 0 left out');
    expect(storedAndRead(passioGo, result.data)).toEqual(result.data);
    const data = passioGoSchema.parse(result.data);
    expect(data.answeredAt).toBe('2026-11-11T03:22:00.000Z');
    expect(data.leftOut).toEqual({ outOfService: 0, outdated: 0, unusable: 0 });
    const byName = new Map(data.shuttles.map((shuttle) => [shuttle.name, shuttle]));
    expect(byName.get('2146')).toMatchObject({
      located: 'gps',
      system: 'nyu',
      vehicleId: '401766',
      route: 'Route A',
      latitude: 40.713396017,
      passengers: 64,
      capacity: 64,
      observedAt: '2026-11-11T03:22:00.000Z',
    });
    expect(byName.get('Shark Shuttle 01')).toMatchObject({
      system: 'liu',
      passengers: null,
      capacity: null,
    });
  });

  it('leaves out buses out of service, outdated or of another system', () => {
    expect(accepted(parse(withFirstBus({ outOfService: 1 }))).data).toMatchObject({
      leftOut: { outOfService: 1, outdated: 0, unusable: 0 },
    });
    expect(accepted(parse(withFirstBus({ outdated: 1 }))).data).toMatchObject({
      leftOut: { outOfService: 0, outdated: 1, unusable: 0 },
    });
    expect(accepted(parse(withFirstBus({ userId: '2494' }))).data).toMatchObject({
      leftOut: { outOfService: 0, outdated: 0, unusable: 1 },
    });
    expect(accepted(parse(withFirstBus({ createdTime: '22:06' }))).coverage).toBe(
      '5 shuttles, 4 with a passenger count, 1 left out',
    );
  });

  it('accepts an answer without buses, written by PHP as an empty list, dated by its clock', () => {
    const result = accepted(parse(json({ buses: [], time: { '1007': '10:22 PM' } })));
    expect(result.coverage).toBe('0 shuttles, 0 with a passenger count, 0 left out');
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:22:00.000Z');
  });

  it('reads a clock time just before midnight as the evening before', () => {
    const afterMidnight = new Date('2026-11-11T05:00:30Z');
    expect(instantOfClock('11:59 PM', afterMidnight)?.toISOString()).toBe(
      '2026-11-11T04:59:00.000Z',
    );
    expect(instantOfClock('12:00 AM', afterMidnight)?.toISOString()).toBe(
      '2026-11-11T05:00:00.000Z',
    );
    expect(instantOfClock('12:05 PM', RECEIVED_AT)?.toISOString()).toBe('2026-11-10T17:05:00.000Z');
    expect(instantOfClock('22:05', RECEIVED_AT)).toBeUndefined();
  });

  it.each([
    ['not-json', text('<b>Fatal error</b>')],
    ['unexpected-shape', json({ buses: {} })],
    ['no-answer-time', json({ buses: {}, time: { '1007': 'soon' } })],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('asks the public map for the five systems in one GET, without a key or a cookie', () => {
    const request = passioGo.request({ credentials: {}, now: RECEIVED_AT });
    const query = new URL(request.url).searchParams;
    expect(query.get('getBuses')).toBe('2');
    expect(JSON.parse(query.get('json') ?? '')).toEqual({
      s0: '1007',
      s1: '7073',
      s2: '1569',
      s3: '5082',
      s4: '466',
      sA: 5,
    });
    expect(request.headers).toEqual({ accept: 'application/json' });
  });
});
