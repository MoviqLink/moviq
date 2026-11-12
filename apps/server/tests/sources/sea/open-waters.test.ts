import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  openWatersSource,
  type HarbourTraffic,
} from '../../../src/modules/data-platform/sources/sea/open-waters.js';
import { accepted, capture, captureJson, json, storedAndRead, text } from '../regional/captures.js';

const source = openWatersSource;
/** Downloaded at 02:51:49 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:51:50Z');

const answerShape = z.looseObject({
  features: z.array(
    z.looseObject({
      geometry: z.unknown(),
      properties: z.looseObject({
        msg_type: z.string(),
        seen: z.string(),
        mmsi: z.number(),
      }),
    }),
  ),
});

function answer(): z.infer<typeof answerShape> {
  return answerShape.parse(captureJson('sea', 'open-waters-new-york-harbor.json'));
}

function parse(body: Uint8Array, receivedAt = RECEIVED_AT) {
  return source.parse(body, { receivedAt, previous: undefined });
}

function read(body: Uint8Array): HarbourTraffic {
  return source.dataSchema.parse(accepted(parse(body)).data);
}

describe('Vessels in New York Harbor', () => {
  it('accepts the capture at its newest position', () => {
    const result = accepted(parse(capture('sea', 'open-waters-new-york-harbor.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:51:24.000Z');
    expect(result.coverage).toBe('12 vessels, 7 under way, 4 left out');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
  });

  it('keeps only positions with a known, recent time, one per MMSI, by GPS', () => {
    const data = read(capture('sea', 'open-waters-new-york-harbor.json'));
    // Four of the sixteen end in static data: their position has no known time.
    expect(data.leftOut.noTime).toBe(4);
    expect(data.vessels.length + Object.values(data.leftOut).reduce((a, b) => a + b, 0)).toBe(16);
    expect(new Set(data.vessels.map((vessel) => vessel.mmsi)).size).toBe(data.vessels.length);
    for (const vessel of data.vessels) {
      expect(vessel.located).toBe('gps');
      const age = RECEIVED_AT.getTime() - Date.parse(vessel.observedAt);
      expect(age).toBeLessThanOrEqual(((vessel.speedKnots ?? 1) < 1 ? 30 : 10) * 60_000);
    }
    expect(new Set(data.vessels.map((vessel) => vessel.network))).toEqual(
      new Set(['AISHub', 'aisstream.io', 'volunteer receivers']),
    );
  });

  it('leaves out a moving vessel after 10 minutes and a stopped one after 30', () => {
    const later = new Date('2026-11-11T03:10:00Z');
    const result = parse(capture('sea', 'open-waters-new-york-harbor.json'), later);
    const data = source.dataSchema.parse(accepted(result).data);
    expect(data.vessels.every((vessel) => (vessel.speedKnots ?? 1) < 1)).toBe(true);
    expect(data.leftOut.old).toBeGreaterThan(0);
  });

  it('leaves out positions in the future, at 0,0 and repeated MMSIs', () => {
    const changed = answer();
    const reports = changed.features.filter(
      (feature) => feature.properties.msg_type === 'PositionReport',
    );
    const [first, second, third, fourth] = reports;
    if (!first || !second || !third || !fourth) throw new Error('too few position reports');
    first.properties.seen = '2026-11-11T03:00:00Z';
    second.geometry = { type: 'Point', coordinates: [0, 0] };
    fourth.properties.mmsi = third.properties.mmsi;
    const data = read(json(changed));
    expect(data.leftOut).toEqual({ noPosition: 2, noTime: 4, old: 0, future: 1 });
    expect(data.vessels).toHaveLength(9);
  });

  it.each([
    ['not-json', text('<html><body>502 Bad Gateway</body></html>')],
    ['unexpected-shape', json({ type: 'Feature' })],
    ['no-vessels', json({ type: 'FeatureCollection', features: [] })],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses through its check an answer older than the one served', () => {
    const data = read(capture('sea', 'open-waters-new-york-harbor.json'));
    const served = { ...data, latestPosition: '2026-11-11T03:00:00.000Z' };
    expect(source.check?.(data, served)).toEqual([expect.stringMatching(/^older-than-served: /)]);
  });

  it('asks anonymously for the harbour heard in the last 30 minutes', () => {
    expect(source.request({ credentials: {}, now: RECEIVED_AT })).toEqual({
      url: 'https://ais.openwaters.io/v1/vessels?bbox=40.45,-74.3,40.95,-73.65&max_age=30m',
      headers: { accept: 'application/geo+json, application/json' },
    });
    expect(source.integration).toBeUndefined();
  });
});
