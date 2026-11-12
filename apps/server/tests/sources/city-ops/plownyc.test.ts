import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { cityOpsSources } from '../../../src/modules/data-platform/sources/city-ops/index.js';
import {
  accepted,
  capture,
  captureJson,
  findSource,
  json,
  storedAndRead,
  text,
} from '../regional/captures.js';

const plowNyc = findSource(cityOpsSources, 'plownyc-status');
/** The capture was downloaded at 03:20:11 UTC on 11/11/2026, with no snowfall. */
const RECEIVED_AT = new Date('2026-11-11T03:20:15Z');

function parse(body: Uint8Array, previous?: unknown) {
  return plowNyc.parse(body, { receivedAt: RECEIVED_AT, previous });
}

function withAnswer(change: Record<string, unknown>): Uint8Array {
  const answer = z
    .record(z.string(), z.unknown())
    .parse(captureJson('city-ops', 'plownyc-active.json'));
  return json({ ...answer, ...change });
}

describe('PlowNYC snow vehicle tracking', () => {
  it('accepts the capture: not tracking, dated by the last recompute', () => {
    const result = accepted(parse(capture('city-ops', 'plownyc-active.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:15:18.493Z');
    expect(result.coverage).toBe('not tracking: no snowfall');
    expect(storedAndRead(plowNyc, result.data)).toEqual(result.data);
    expect(result.data).toEqual({
      tracking: false,
      computedAt: '2026-11-11T03:15:18.493Z',
      nextComputeAt: '2026-11-11T03:30:18.493Z',
      answeredAt: '2026-11-11T03:20:12.538Z',
    });
  });

  it('reads tracking during a snowfall', () => {
    const result = accepted(parse(withAnswer({ Active: true })));
    expect(result.coverage).toBe('tracking snow vehicles');
    expect(result.data).toMatchObject({ tracking: true });
  });

  it.each([
    ['not-json', text('<html><body>The page cannot be displayed</body></html>')],
    ['unexpected-shape', withAnswer({ Active: 'no' })],
    ['future-update', withAnswer({ LastModified: '2026-11-11T03:45:18.493Z' })],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses a recompute older than the one served', () => {
    const served = accepted(parse(capture('city-ops', 'plownyc-active.json'))).data;
    const older = accepted(parse(withAnswer({ LastModified: '2026-11-11T03:00:18.277Z' }))).data;
    expect(plowNyc.check?.(older, served)).toEqual([
      'older-than-served: the candidate is from 2026-11-11T03:00:18.277Z, ' +
        'the served data from 2026-11-11T03:15:18.493Z',
    ]);
  });

  it('adds the time in milliseconds to the request, as the map does past its one-year cache', () => {
    expect(plowNyc.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://plownyc.nyc.gov/mappingapi/api/highlight/active?now=1794367215000',
    );
  });
});
