import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  nwsAlertsSource,
  type NewYorkWeatherAlerts,
} from '../../../src/modules/data-platform/sources/city/nws-alerts.js';

const source = nwsAlertsSource;

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../../tests/fixtures/city/${name}`, import.meta.url)),
    'utf8',
  );
}

/** The five boroughs at 01:04:10 UTC on 11/11/2026: no active alert. */
const newYork = fixture('nws-alerts-new-york.geojson');
/** New Jersey at 01:08:18 UTC on 11/11/2026: one real Frost Advisory, outside New York City. */
const newJersey = fixture('nws-alerts-new-jersey.geojson');
const receivedAt = new Date('2026-11-11T01:08:18Z');

function parse(text: string) {
  return source.parse(new TextEncoder().encode(text), { receivedAt, previous: undefined });
}

function parsed(text: string): NewYorkWeatherAlerts {
  const result = parse(text);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

describe('NWS alerts for New York', () => {
  it('accepts the real capture without alerts as valid data with its time', () => {
    const result = parse(newYork);
    expect(result).toMatchObject({
      ok: true,
      dataTime: new Date('2026-11-11T01:00:00Z'),
      coverage: '6 zones, 0 active alerts',
      data: { updatedAt: '2026-11-11T01:00:00.000Z', alerts: [] },
    });
    if (result.ok) expect(source.check?.(result.data, undefined)).toEqual([]);
  });

  it('normalises a real alert, with onset and end as instants', () => {
    const data = parsed(newJersey);
    expect(data.updatedAt).toBe('2026-11-11T01:07:11.000Z');
    expect(data.alerts).toHaveLength(1);
    expect(data.alerts[0]).toMatchObject({
      event: 'Frost Advisory',
      severity: 'Minor',
      messageType: 'Alert',
      sender: 'NWS Mount Holly NJ',
      zones: ['NJZ016', 'NJZ017', 'NJZ018', 'NJZ021'],
      sentAt: '2026-11-10T18:12:00.000Z',
      startsAt: '2026-11-11T06:00:00.000Z',
      endsAt: '2026-11-11T14:00:00.000Z',
      expiresAt: '2026-11-11T09:00:00.000Z',
      instruction: 'Take steps now to protect tender plants from the cold.',
    });
  });

  it('keeps the parsed data through JSON storage and its schema', () => {
    for (const text of [newYork, newJersey]) {
      const data = parsed(text);
      const stored: unknown = JSON.parse(JSON.stringify(data));
      expect(source.dataSchema.parse(stored)).toEqual(data);
    }
  });

  it('leaves out test and exercise messages', () => {
    expect(parsed(newJersey.replace('"status": "Actual"', '"status": "Test"')).alerts).toEqual([]);
  });

  describe('refuses each failure of its catalogue with its code', () => {
    const refusals: readonly (readonly [string, string])[] = [
      ['not-json', '<html><body>Bad Gateway</body></html>'],
      [
        'unexpected-shape',
        '{"type":"https://api.weather.gov/problems/UnexpectedProblem","status":500}',
      ],
    ];
    it.each(refusals)('%s', (code, text) => {
      expect(parse(text)).toMatchObject({ ok: false, code });
    });

    it('older-than-served and outside-zones', () => {
      const empty = parsed(newYork);
      const newer = { ...empty, updatedAt: '2026-11-11T01:10:50.000Z' };
      expect(source.check?.(empty, newer)).toEqual([expect.stringMatching(/^older-than-served: /)]);
      expect(source.check?.(parsed(newJersey), undefined)).toEqual([
        expect.stringMatching(/^outside-zones: .*Frost Advisory.*NJZ016/),
      ]);
    });

    it('covers every code of the catalogue', () => {
      expect(source.failures.map((failure) => failure.code).sort()).toEqual(
        [...refusals.map(([code]) => code), 'older-than-served', 'outside-zones'].sort(),
      );
    });
  });

  it('asks for the active alerts of the five boroughs as GeoJSON', () => {
    expect(source.request({ credentials: {}, now: receivedAt })).toEqual({
      url: 'https://api.weather.gov/alerts/active?zone=NYZ072,NYZ073,NYZ074,NYZ075,NYZ176,NYZ178',
      headers: { accept: 'application/geo+json' },
    });
  });
});
