import { describe, expect, it } from 'vitest';

import { harborSources } from '../../../src/modules/data-platform/sources/harbor/index.js';
import { portsReadingSchema } from '../../../src/modules/data-platform/sources/harbor/noaa-ports-reading.js';
import {
  accepted,
  capture,
  captureJson,
  findSource,
  json,
  storedAndRead,
  text,
} from '../regional/captures.js';

/** The NOAA captures were downloaded between 03:40:01 and 03:40:59 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:41:00Z');

function parse(id: string, body: Uint8Array, previous?: unknown) {
  return findSource(harborSources, id).parse(body, { receivedAt: RECEIVED_AT, previous });
}

function reading(id: string, file: string) {
  return portsReadingSchema.parse(accepted(parse(id, capture('harbor', file))).data);
}

describe('NOAA PORTS, New York and New Jersey Harbor', () => {
  it.each([
    ['noaa-ports-battery-water-level', 'noaa-battery-water-level.json', '2026-11-11T03:30:00.000Z'],
    ['noaa-ports-verrazzano-air-gap', 'noaa-verrazzano-air-gap.json', '2026-11-11T03:30:00.000Z'],
    [
      'noaa-ports-kill-van-kull-current',
      'noaa-kill-van-kull-current.json',
      '2026-11-11T03:29:00.000Z',
    ],
    ['noaa-ports-robbins-reef-wind', 'noaa-robbins-reef-wind.json', '2026-11-11T03:36:00.000Z'],
  ])('%s accepts its capture, dated by its newest measurement', (id, file, time) => {
    const result = accepted(parse(id, capture('harbor', file)));
    expect(result.dataTime.toISOString()).toBe(time);
    expect(storedAndRead(findSource(harborSources, id), result.data)).toEqual(result.data);
  });

  it('reads each measure in metric units, as NOAA defines its columns', () => {
    expect(reading('noaa-ports-battery-water-level', 'noaa-battery-water-level.json')).toEqual({
      station: { id: '8518750', name: 'The Battery', latitude: 40.7006, longitude: -74.0142 },
      observation: {
        measure: 'water-level',
        observedAt: '2026-11-11T03:30:00.000Z',
        metresAboveChartDatum: 1.188,
        preliminary: true,
        flagged: false,
      },
    });
    expect(
      reading('noaa-ports-verrazzano-air-gap', 'noaa-verrazzano-air-gap.json').observation,
    ).toMatchObject({ measure: 'air-gap', metres: 69.794, flagged: false });
    expect(
      reading('noaa-ports-kill-van-kull-current', 'noaa-kill-van-kull-current.json').observation,
    ).toEqual({
      measure: 'current',
      observedAt: '2026-11-11T03:29:00.000Z',
      centimetresPerSecond: 39.7,
      directionDegrees: 58,
    });
    expect(
      reading('noaa-ports-robbins-reef-wind', 'noaa-robbins-reef-wind.json').observation,
    ).toEqual({
      measure: 'wind',
      observedAt: '2026-11-11T03:36:00.000Z',
      metresPerSecond: 6.3,
      gustMetresPerSecond: 7.7,
      directionDegrees: 268,
      flagged: false,
    });
  });

  it('marks a value that exceeded a NOAA limit, but not a count of outlying samples', () => {
    const answer = (flags: string) => ({
      metadata: { id: '8518750', name: 'The Battery', lat: '40.7006', lon: '-74.0142' },
      data: [{ t: '2026-11-11 03:30', v: '1.188', s: '0.032', f: flags, q: 'p' }],
    });
    const flaggedOf = (flags: string) =>
      portsReadingSchema.parse(
        accepted(parse('noaa-ports-battery-water-level', json(answer(flags)))).data,
      ).observation;
    expect(flaggedOf('3,0,0,0')).toMatchObject({ flagged: false });
    expect(flaggedOf('0,0,1,0')).toMatchObject({ flagged: true });
  });

  it('asks for metric GMT values with a neutral application name, without a key', () => {
    for (const definition of harborSources.filter((one) => one.id.startsWith('noaa-ports-'))) {
      const url = new URL(definition.request({ credentials: {}, now: RECEIVED_AT }).url);
      expect(url.origin + url.pathname).toBe(
        'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
      );
      expect(url.searchParams.get('application')).toBe('public-transit-viewer');
      expect(url.searchParams.get('units')).toBe('metric');
      expect(url.searchParams.get('time_zone')).toBe('gmt');
      expect(definition.integration).toBeUndefined();
    }
  });

  it('refuses a reading older than the one served', () => {
    const id = 'noaa-ports-robbins-reef-wind';
    const served = reading(id, 'noaa-robbins-reef-wind.json');
    const older = findSource(harborSources, id).check?.(
      { ...served, observation: { ...served.observation, observedAt: '2026-11-11T03:00:00.000Z' } },
      served,
    );
    expect(older?.[0]).toMatch(/^older-than-served/);
  });

  it.each([
    ['no-data', capture('harbor', 'noaa-narrows-no-data.json')],
    ['not-json', text('<html>503</html>')],
    ['unexpected-shape', json({ metadata: { id: 'n06010' }, data: [] })],
    [
      'wrong-station',
      json({
        ...asObject(captureJson('harbor', 'noaa-kill-van-kull-current.json')),
        metadata: { id: 'n03020', name: 'The Narrows', lat: '40.6', lon: '-74.0' },
      }),
    ],
    [
      'no-data',
      json({
        ...asObject(captureJson('harbor', 'noaa-kill-van-kull-current.json')),
        data: [{ t: '2026-11-11 03:29', s: '', d: '58' }],
      }),
    ],
  ])('the current station refuses %s', (code, body) => {
    expect(parse('noaa-ports-kill-van-kull-current', body)).toMatchObject({ ok: false, code });
  });
});

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('not an object');
  return Object.fromEntries(Object.entries(value));
}
