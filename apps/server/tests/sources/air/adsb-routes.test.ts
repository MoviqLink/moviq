import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { adsbRoutesSource } from '../../../src/modules/data-platform/sources/air/adsb-routes.js';
import { accepted, capture, storedAndRead, text } from '../regional/captures.js';

const source = adsbRoutesSource;
/** Downloaded at 02:52:38 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:52:40Z');

function parse(body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

describe('Usual routes of flights through New York', () => {
  it('keeps the routes through JFK, LaGuardia or Newark, dated by receipt', () => {
    const result = accepted(parse(capture('air', 'adsb-routes.csv.gz')));
    expect(source.dataTimeSource).toBe('receipt');
    expect(result.dataTime).toEqual(RECEIVED_AT);
    // 20 rows: 12 through New York, 6 elsewhere and 2 with a three-letter airport code.
    expect(result.coverage).toBe('12 routes through New York, 2 rows left out');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
    const data = source.dataSchema.parse(result.data);
    for (const airports of Object.values(data.routes)) {
      expect(airports.some((code) => ['KJFK', 'KLGA', 'KEWR'].includes(code))).toBe(true);
    }
  });

  it('checks that a real file has thousands of routes through New York', () => {
    const data = source.dataSchema.parse(
      accepted(parse(capture('air', 'adsb-routes.csv.gz'))).data,
    );
    expect(source.check?.(data, undefined)).toEqual([
      'too-few-routes: 12 routes, minimum 5,600 routes',
    ]);
  });

  it.each([
    ['not-gzip', text('<html><body>404 Not Found</body></html>')],
    ['corrupt-gzip', capture('air', 'adsb-routes.csv.gz').subarray(0, 120)],
    ['unexpected-shape', gzipSync(text('Flight,From,To\nUAL1,KJFK,KSFO\n'))],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('downloads the table adsb.lol republishes', () => {
    expect(source.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://vrs-standing-data.adsb.lol/routes.csv.gz',
    );
  });
});
