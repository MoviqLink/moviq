import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { adsbFiSource } from '../../../src/modules/data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../../../src/modules/data-platform/sources/air/adsb-lol.js';
import type { AirTraffic } from '../../../src/modules/data-platform/sources/air/aircraft.js';
import { accepted, capture, captureJson, json, storedAndRead, text } from '../regional/captures.js';

/** Downloaded at 02:51:52 (adsb.lol) and 02:51:54 UTC (adsb.fi) on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:51:55Z');

const answerShape = z.looseObject({ ac: z.array(z.looseObject({})) });

function lolAnswer(): z.infer<typeof answerShape> {
  return answerShape.parse(captureJson('air', 'adsb-lol-new-york.json'));
}

function parse(source: typeof adsbLolSource, body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

/** The accepted data, typed by reading it through its schema. */
function read(source: typeof adsbLolSource, file: string): AirTraffic {
  return source.dataSchema.parse(accepted(parse(source, capture('air', file))).data);
}

describe('Aircraft around the New York airports', () => {
  it('accepts the adsb.lol capture at the time of the answer', () => {
    const result = accepted(parse(adsbLolSource, capture('air', 'adsb-lol-new-york.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:51:52.000Z');
    expect(result.coverage).toBe('9 aircraft, 6 airborne, 0 left out');
    expect(storedAndRead(adsbLolSource, result.data)).toEqual(result.data);
  });

  it('accepts the adsb.fi capture, whose time is in seconds and list in aircraft', () => {
    const result = accepted(parse(adsbFiSource, capture('air', 'adsb-fi-new-york.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:51:54.000Z');
    expect(result.coverage).toBe('9 aircraft, 6 airborne, 0 left out');
    expect(storedAndRead(adsbFiSource, result.data)).toEqual(result.data);
    expect(adsbLolSource.fallback).toBe(adsbFiSource.id);
  });

  it('says how each aircraft was placed and dates its position', () => {
    for (const [source, file] of [
      [adsbLolSource, 'adsb-lol-new-york.json'],
      [adsbFiSource, 'adsb-fi-new-york.json'],
    ] as const) {
      const data = read(source, file);
      expect(data.aircraft.every((plane) => plane.located === 'gps')).toBe(true);
      const parked = data.aircraft.filter((plane) => plane.onGround);
      expect(parked).toHaveLength(3);
      for (const plane of parked) expect(plane.altitudeFeet).toBeNull();
      for (const plane of data.aircraft) {
        expect(Date.parse(plane.observedAt)).toBeLessThanOrEqual(Date.parse(data.answeredAt));
      }
    }
  });

  it('places TIS-B tracks by radar and multilateration by receivers', () => {
    const changed = lolAnswer();
    const [first, second] = changed.ac;
    if (first) first['type'] = 'tisb_icao';
    if (second) second['type'] = 'mlat';
    const data = adsbLolSource.dataSchema.parse(accepted(parse(adsbLolSource, json(changed))).data);
    expect(data.aircraft.slice(0, 2).map((plane) => plane.located)).toEqual([
      'radar',
      'multilateration',
    ]);
  });

  it('leaves out and counts an aircraft placed by Mode S only or without a position', () => {
    const changed = lolAnswer();
    const [first, second] = changed.ac;
    if (first) first['type'] = 'mode_s';
    if (second) delete second['lat'];
    expect(accepted(parse(adsbLolSource, json(changed))).coverage).toMatch(
      /^7 aircraft, \d airborne, 2 left out$/,
    );
  });

  it.each([
    ['not-json', text('<html><body>502 Bad Gateway</body></html>')],
    ['unexpected-shape', json({ error: 'rate limited' })],
    ['unexpected-shape', json({ ...lolAnswer(), ac: undefined, aircraft: [] })],
    ['provider-error', json({ ...lolAnswer(), msg: 'Internal error' })],
    ['future-answer', json({ ...lolAnswer(), now: Date.parse('2026-11-11T03:00:00Z') })],
    ['empty-area', json({ ...lolAnswer(), ac: [] })],
  ])('refuses %s', (code, body) => {
    expect(parse(adsbLolSource, body)).toMatchObject({ ok: false, code });
  });

  it('refuses through its check an answer older than the one served', () => {
    const data = read(adsbLolSource, 'adsb-lol-new-york.json');
    const served = { ...data, answeredAt: '2026-11-11T03:00:00.000Z' };
    expect(adsbLolSource.check?.(data, served)).toEqual([
      expect.stringMatching(/^older-than-served: /),
    ]);
  });

  it('keeps adsb.lol under its 500 requests a day and declares both rate limits', () => {
    for (const source of [adsbLolSource, adsbFiSource]) {
      expect(source.failures.find((known) => known.code === 'http-429')?.state).toBe(
        'rate_limited',
      );
    }
    const perDay = 24 * 60 * 60_000;
    expect(perDay / (adsbLolSource.rhythm.interestIntervalMs ?? 0)).toBeLessThan(500);
  });

  it('asks both providers for a circle of 25 nautical miles around the three airports', () => {
    expect(adsbLolSource.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://api.adsb.lol/v2/point/40.7/-73.95/25',
    );
    expect(adsbFiSource.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://opendata.adsb.fi/api/v2/lat/40.7/lon/-73.95/dist/25',
    );
  });
});
