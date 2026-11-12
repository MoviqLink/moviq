import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  fromNewYorkWallClockText,
  toNewYorkWallClockText,
} from '../../../src/infrastructure/clock/new-york.js';
import { parseLinkPoints } from '../../../src/modules/data-platform/sources/city/nyc-dot-link-points.js';
import {
  nycDotTrafficSpeedsSource,
  type TrafficSpeeds,
} from '../../../src/modules/data-platform/sources/city/nyc-dot-traffic-speeds.js';

const source = nycDotTrafficSpeedsSource;

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../../tests/fixtures/city/${name}`, import.meta.url)),
    'utf8',
  );
}

const capture = fixture('nyc-dot-traffic-speeds.json');
/** Downloaded at 01:05:21 UTC on 11/11/2026; the newest reading is 18:07:07 New York time. */
const receivedAt = new Date('2026-11-11T01:05:21Z');

function parse(text: string, at: Date = receivedAt, previous?: TrafficSpeeds) {
  return source.parse(new TextEncoder().encode(text), { receivedAt: at, previous });
}

function parsed(text: string): TrafficSpeeds {
  const result = parse(text);
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

const rowsSchema = z.array(z.looseObject({ id: z.string(), data_as_of: z.string() }));
const rows = rowsSchema.parse(JSON.parse(capture));

describe('NYC DOT traffic speeds', () => {
  it('accepts the real capture with the time and coverage of its readings', () => {
    const result = parse(capture);
    expect(result).toMatchObject({
      ok: true,
      dataTime: new Date('2026-11-10T23:07:07Z'),
      coverage: '10 segments, 3 suspect',
    });
    if (!result.ok) return;
    const ids = [...result.data.segments, ...result.data.suspect].map((segment) => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.data.suspect.map((segment) => segment.reason)).toEqual([
      'anomalous-reading',
      'anomalous-reading',
      'anomalous-reading',
    ]);
  });

  it('serves the newest reading of a segment and ignores its history', () => {
    const history = rows.filter((row) => row.id === '311');
    expect(history).toHaveLength(2);
    const segment = parsed(capture).segments.find((candidate) => candidate.id === '311');
    expect(segment?.measuredAt).toBe(
      fromNewYorkWallClockText(history[0]?.data_as_of ?? '')?.toISOString(),
    );
  });

  it('turns link_points into validated longitude and latitude pairs', () => {
    const data = parsed(capture);
    for (const segment of [...data.segments, ...data.suspect]) {
      for (const [longitude, latitude] of segment.path ?? []) {
        expect(longitude).toBeGreaterThan(-74.4);
        expect(longitude).toBeLessThan(-73.6);
        expect(latitude).toBeGreaterThan(40.4);
        expect(latitude).toBeLessThan(41);
      }
    }
    expect(data.droppedPoints).toBeGreaterThan(0);
    const cut = parseLinkPoints(
      `${'40.78795,-73.790191 '.repeat(12)}40.7795604,-73.9`.slice(0, 255),
    );
    expect(cut.dropped).toBe(1);
    expect(parseLinkPoints('40.7,-73.9 51.5,-0.1 40.8,-73.8 broken')).toEqual({
      path: [
        [-73.9, 40.7],
        [-73.8, 40.8],
      ],
      dropped: 2,
    });
    expect(parseLinkPoints('40.7,-73.9').path).toBeNull();
  });

  it('keeps segments with old readings apart as suspect', () => {
    const id = '436';
    expect(rows.filter((row) => row.id === id)).toHaveLength(1);
    const old = JSON.stringify(
      rows.map((row) => (row.id === id ? { ...row, data_as_of: '2026-11-10T17:30:00.000' } : row)),
    );
    const data = parsed(old);
    expect(data.suspect.find((segment) => segment.id === id)?.reason).toBe('old-measurement');
    expect(data.segments.some((segment) => segment.id === id)).toBe(false);
  });

  it('keeps the parsed data through JSON storage and its schema', () => {
    const data = parsed(capture);
    const stored: unknown = JSON.parse(JSON.stringify(data));
    expect(source.dataSchema.parse(stored)).toEqual(data);
  });

  describe('refuses each failure of its catalogue with its code', () => {
    const zeroRows = JSON.stringify(
      rowsSchema.parse(JSON.parse(capture)).filter((row) => ['324', '195', '186'].includes(row.id)),
    );
    const refusals: readonly (readonly [string, string, Date])[] = [
      ['not-json', '<html><body>Service unavailable</body></html>', receivedAt],
      ['unexpected-shape', '{"error":true,"message":"query.compiler.malformed"}', receivedAt],
      [
        'bad-timestamp',
        capture.replace(`"${rows[0]?.data_as_of ?? ''}"`, '"11/10/2026 06:07:07 PM"'),
        receivedAt,
      ],
      ['no-recent-readings', fixture('nyc-dot-traffic-speeds-empty.json'), receivedAt],
      ['future-measurement', capture, new Date('2026-11-10T22:00:00Z')],
      ['no-valid-readings', zeroRows, receivedAt],
    ];
    it.each(refusals)('%s', (code, text, at) => {
      expect(parse(text, at)).toMatchObject({ ok: false, code });
    });

    it('older-than-served and coverage-drop', () => {
      const data = parsed(capture);
      const newer = { ...data, measuredUpTo: '2026-11-10T23:12:07.000Z' };
      expect(source.check?.(data, newer)).toEqual([expect.stringMatching(/^older-than-served: /)]);
      const fuller = { ...data, segments: [...data.segments, ...data.segments, ...data.segments] };
      expect(source.check?.(data, fuller)).toEqual([expect.stringMatching(/^coverage-drop: /)]);
      expect(source.check?.(data, data)).toEqual([]);
    });

    it('covers every code of the catalogue', () => {
      expect(source.failures.map((failure) => failure.code).sort()).toEqual(
        [...refusals.map(([code]) => code), 'older-than-served', 'coverage-drop'].sort(),
      );
    });
  });

  it('asks for the last 4 hours of readings in New York time', () => {
    const { url } = source.request({ credentials: {}, now: receivedAt });
    expect(url).toContain("$where=data_as_of%20%3E%20'2026-11-10T16%3A05%3A21'");
    expect(url).toContain('$order=data_as_of%20DESC');
    expect(url).toContain('$limit=1000');
  });

  it('converts New York wall-clock times across daylight saving', () => {
    expect(fromNewYorkWallClockText('2026-11-10T18:07:07.000')).toEqual(
      new Date('2026-11-10T23:07:07Z'),
    );
    expect(fromNewYorkWallClockText('2026-07-01T12:00:00')).toEqual(
      new Date('2026-07-01T16:00:00Z'),
    );
    expect(fromNewYorkWallClockText('2026-03-08T02:30:00')).toBeUndefined();
    expect(fromNewYorkWallClockText('2026-02-30T12:00:00')).toBeUndefined();
    expect(toNewYorkWallClockText(new Date('2026-11-01T05:30:00Z'))).toBe('2026-11-01T01:30:00');
  });
});
