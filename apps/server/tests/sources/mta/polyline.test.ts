import { describe, expect, it } from 'vitest';

import {
  decodePolyline,
  encodePolyline,
} from '../../../src/modules/data-platform/sources/mta/polyline.js';

describe('encoded polylines', () => {
  it('writes and reads the example of the format reference', () => {
    const points = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    const text = encodePolyline(points);
    expect(text).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(text)).toEqual(points);
  });

  it('keeps five decimals and the sign of each step', () => {
    const points = [
      { lat: 40.851695, lon: -73.937969 },
      { lat: 40.851694, lon: -73.937968 },
      { lat: -33.5, lon: 151.25 },
    ];
    const read = decodePolyline(encodePolyline(points)) ?? [];
    expect(read).toHaveLength(3);
    for (const [index, point] of read.entries()) {
      const rounded = (value = 0) => Math.round(value * 1e5) / 1e5;
      expect(point.lat).toBeCloseTo(rounded(points[index]?.lat), 9);
      expect(point.lon).toBeCloseTo(rounded(points[index]?.lon), 9);
    }
  });

  it('refuses a text that is not a polyline', () => {
    expect(decodePolyline('abc def')).toBeUndefined();
    // A number cut short: the last character still announces more.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq')).toBeUndefined();
    // A latitude past the pole.
    expect(
      decodePolyline(encodePolyline([{ lat: 89, lon: 0 }]) + encodePolyline([{ lat: 2, lon: 0 }])),
    ).toBeUndefined();
    expect(decodePolyline('')).toEqual([]);
  });
});
