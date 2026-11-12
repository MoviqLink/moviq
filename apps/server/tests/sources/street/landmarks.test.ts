import { describe, expect, it } from 'vitest';
import { nycLandmarks } from '../../../src/modules/data-platform/sources/street/landmarks.js';
import { accepted, capture, captureJson, text } from '../ny511/captures.js';

const receivedAt = new Date('2026-11-11T05:30:00Z');
const context = { receivedAt, previous: undefined };
const parse = () => accepted(nycLandmarks.parse(capture('street', 'landmarks.json'), context));
describe('NYC designated landmarks', () => {
  it('reads designated places with coordinates and keeps the official date and address', () => {
    const result = parse();
    expect(result.data.landmarks.length).toBeGreaterThan(1400);
    expect(new Set(result.data.landmarks.map((item) => item.id)).size).toBe(
      result.data.landmarks.length,
    );
    expect(result.data.landmarks.find((item) => item.id.startsWith('LP-02694:'))).toMatchObject({
      address: '440 GRAND STREET',
      designatedOn: '2026-04-07',
    });
    expect(nycLandmarks.dataSchema.parse(result.data)).toEqual(result.data);
    expect(nycLandmarks.check?.(result.data, undefined)).toEqual([]);
  });
  it('leaves out a row without coordinates, rejects non-lists and flags truncated data', () => {
    const rows = captureJson('street', 'landmarks.json');
    if (!Array.isArray(rows)) throw new Error('capture is not a list');
    const result = accepted(
      nycLandmarks.parse(text(JSON.stringify([{ ...rows[0], latitude: null }])), context),
    );
    expect(result.data.leftOut).toBe(1);
    expect(nycLandmarks.check?.(result.data, undefined)).not.toEqual([]);
    expect(nycLandmarks.parse(text('{}'), context)).toMatchObject({
      ok: false,
      code: 'unexpected-shape',
    });
  });
});
