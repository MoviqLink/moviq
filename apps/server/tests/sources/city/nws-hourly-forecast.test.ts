import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  nwsHourlyForecastSource,
  type HourlyForecast,
} from '../../../src/modules/data-platform/sources/city/nws-hourly-forecast.js';

const source = nwsHourlyForecastSource;

/** OKX/34,44 at 01:04:28 UTC on 11/11/2026, cut to its first 24 hours. */
const capture = readFileSync(
  fileURLToPath(
    new URL('../../../../../tests/fixtures/city/nws-hourly-forecast.geojson', import.meta.url),
  ),
  'utf8',
);
const receivedAt = new Date('2026-11-11T01:04:28Z');

function parse(text: string, at: Date = receivedAt) {
  return source.parse(new TextEncoder().encode(text), { receivedAt: at, previous: undefined });
}

function parsed(text: string): HourlyForecast {
  const result = parse(text);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

const documentSchema = z.looseObject({
  properties: z.looseObject({ periods: z.array(z.unknown()) }),
});

/** The capture with one hour taken out of the middle. */
function withoutHour(index: number): string {
  const document = documentSchema.parse(JSON.parse(capture));
  document.properties.periods.splice(index, 1);
  return JSON.stringify(document);
}

describe('NWS hourly forecast for Manhattan', () => {
  it('accepts the real capture with the time of the forecast and its hours', () => {
    const result = parse(capture);
    expect(result).toMatchObject({
      ok: true,
      dataTime: new Date('2026-11-10T23:08:50Z'),
      coverage: '24 hours, until 2026-11-12T00:00:00.000Z',
    });
    if (!result.ok) return;
    expect(result.data.location.gridpoint).toBe('OKX/34,44');
    expect(result.data.hours[0]).toEqual({
      startsAt: '2026-11-11T00:00:00.000Z',
      endsAt: '2026-11-11T01:00:00.000Z',
      isDaytime: false,
      temperatureC: 17,
      dewpointC: 3.3333333333333335,
      precipitationChance: 0,
      relativeHumidity: 41,
      windKmh: { min: 11, max: 11 },
      windDirection: 'W',
      summary: 'Clear',
    });
  });

  it('keeps the parsed data through JSON storage and its schema', () => {
    const data = parsed(capture);
    const stored: unknown = JSON.parse(JSON.stringify(data));
    expect(source.dataSchema.parse(stored)).toEqual(data);
  });

  it('reads a wind range in km/h', () => {
    const range = parsed(capture.replace('"windSpeed": "11 km/h"', '"windSpeed": "10 to 15 km/h"'));
    expect(range.hours[0]?.windKmh).toEqual({ min: 10, max: 15 });
  });

  describe('refuses each failure of its catalogue with its code', () => {
    const refusals: readonly (readonly [string, string, Date])[] = [
      ['not-json', '<html><body>Gateway Timeout</body></html>', receivedAt],
      ['unexpected-shape', '{"properties":{"periods":[]}}', receivedAt],
      [
        'wrong-units',
        capture.replace('"windSpeed": "11 km/h"', '"windSpeed": "7 mph"'),
        receivedAt,
      ],
      ['broken-sequence', withoutHour(5), receivedAt],
      ['no-future-hours', capture, new Date('2026-11-12T00:00:00Z')],
    ];
    it.each(refusals)('%s', (code, text, at) => {
      expect(parse(text, at)).toMatchObject({ ok: false, code });
    });

    it('older-than-served', () => {
      const data = parsed(capture);
      const newer = { ...data, updatedAt: '2026-11-11T00:30:00.000Z' };
      expect(source.check?.(data, newer)).toEqual([expect.stringMatching(/^older-than-served: /)]);
      expect(source.check?.(data, data)).toEqual([]);
    });

    it('covers every code of the catalogue', () => {
      expect(source.failures.map((failure) => failure.code).sort()).toEqual(
        [...refusals.map(([code]) => code), 'older-than-served'].sort(),
      );
    });
  });

  it('asks for the fixed grid cell in SI units', () => {
    expect(source.request({ credentials: {}, now: receivedAt }).url).toBe(
      'https://api.weather.gov/gridpoints/OKX/34,44/forecast/hourly?units=si',
    );
  });
});
