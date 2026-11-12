import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { decodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import {
  gtfsIndexSchema,
  type GtfsIndex,
} from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { railTimetableSources } from '../../../src/modules/data-platform/sources/regional/rail-timetables.js';
import { accepted, capture, findSource, storedAndRead, text } from './captures.js';

const lirr = findSource(railTimetableSources, 'mta-gtfs-lirr');
const metroNorth = findSource(railTimetableSources, 'mta-gtfs-metro-north');
/** Downloaded at 02:23:23-29 UTC on 11/11/2026, 21:23 on 10/11 in New York. */
const RECEIVED_AT = new Date('2026-11-11T02:23:30Z');
const decoder = new TextDecoder();

function parse(
  source: typeof lirr,
  body: Uint8Array,
  receivedAt = RECEIVED_AT,
  previous?: GtfsIndex,
) {
  return source.parse(body, { receivedAt, previous });
}

function index(source: typeof lirr, file: string): GtfsIndex {
  return gtfsIndexSchema.parse(accepted(parse(source, capture('regional', file))).data);
}

/** The Metro-North capture rebuilt with some tables changed, dated as the original. */
function rebuilt(change: (tables: Record<string, string>) => void): Uint8Array {
  const tables = Object.fromEntries(
    Object.entries(unzipSync(capture('regional', 'gtfsmnr.zip'))).map(([name, data]) => [
      name,
      decoder.decode(data),
    ]),
  );
  change(tables);
  const entries = Object.fromEntries(
    Object.entries(tables).map(([name, content]) => [name, text(content)] as const),
  );
  return zipSync(entries, { mtime: new Date(2026, 10, 10, 14, 40) });
}

describe('LIRR and Metro-North timetables', () => {
  it('accepts the LIRR capture, dated by its receipt', () => {
    const result = accepted(parse(lirr, capture('regional', 'gtfslirr.zip')));
    expect(result.dataTime).toEqual(RECEIVED_AT);
    expect(lirr.dataTimeSource).toBe('receipt');
    expect(result.coverage).toBe('12 routes, 0 stations, 127 stops, 31 trips, 0 shapes');
    expect(lirr.check?.(result.data, undefined)).toEqual([]);
    expect(storedAndRead(lirr, result.data)).toEqual(result.data);
  });

  it('accepts the Metro-North capture, dated by its archive in New York time', () => {
    const result = accepted(parse(metroNorth, capture('regional', 'gtfsmnr.zip')));
    // 14:40 on 10/11/2026 in New York, the minute S3 received the file.
    expect(result.dataTime.toISOString()).toBe('2026-11-10T19:40:00.000Z');
    expect(result.coverage).toBe('6 routes, 0 stations, 114 stops, 19 trips, 0 shapes');
    expect(metroNorth.check?.(result.data, undefined)).toEqual([]);
    expect(storedAndRead(metroNorth, result.data)).toEqual(result.data);
  });

  it('names the trips of the LIRR live capture, whose ids join the timetable', () => {
    const timetable = index(lirr, 'gtfslirr.zip');
    const live = decodeGtfsRealtime(capture('regional', 'lirr-realtime.pb'));
    if (!live.ok) throw new Error(live.detail);
    const tripIds = live.feed.entity.flatMap((entity) => entity.trip_update?.trip.trip_id ?? []);
    expect(tripIds.length).toBeGreaterThan(0);
    for (const tripId of tripIds) expect(timetable.trips[tripId]?.headsign).toBeTruthy();
  });

  it('reads the LIRR receipt time even when its archive dates look later', () => {
    // The archive says 15:33 on 10/11; read as New York time that is 20:33 UTC, after a download
    // at 15:00 UTC. A receipt-dated source must not refuse it as published in the future.
    const result = parse(lirr, capture('regional', 'gtfslirr.zip'), new Date('2026-11-10T15:00Z'));
    expect(result).toMatchObject({ ok: true, dataTime: new Date('2026-11-10T15:00Z') });
  });

  it.each([
    ['not-zip', text('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>')],
    ['truncated-zip', capture('regional', 'gtfsmnr.zip').subarray(0, 4_000)],
    [
      'missing-file',
      rebuilt((tables) => {
        delete tables['stop_times.txt'];
      }),
    ],
    [
      'invalid-row',
      rebuilt((tables) => {
        tables['stops.txt'] = (tables['stops.txt'] ?? '').replace('40.752998', 'north');
      }),
    ],
    [
      'broken-reference',
      rebuilt((tables) => {
        tables['routes.txt'] = (tables['routes.txt'] ?? '').replace(/^3,1,.*$/m, '');
      }),
    ],
  ])('refuses %s', (code, body) => {
    expect(parse(metroNorth, body)).toMatchObject({ ok: false, code });
  });

  it('refuses a file published after its download or before the version served', () => {
    const body = capture('regional', 'gtfsmnr.zip');
    const early = new Date('2026-11-10T19:00:00Z');
    expect(parse(metroNorth, body, early)).toMatchObject({ code: 'future-publication' });
    const served = { ...index(metroNorth, 'gtfsmnr.zip') };
    const newer = { ...served, feed: { ...served.feed, publishedAt: '2026-11-11T00:00:00.000Z' } };
    expect(parse(metroNorth, body, RECEIVED_AT, newer)).toMatchObject({
      code: 'older-than-served',
    });
  });

  it('refuses a day the calendar does not cover', () => {
    // Metro-North's calendar ends on 23/05/2027.
    const later = new Date('2027-06-01T15:00:00Z');
    expect(parse(metroNorth, capture('regional', 'gtfsmnr.zip'), later)).toMatchObject({
      code: 'no-service-today',
    });
  });

  it('checks a minimum and a shrinking file', () => {
    const served = index(lirr, 'gtfslirr.zip');
    const routes = Object.fromEntries(Object.entries(served.routes).slice(0, 2));
    const partial = { ...served, routes };
    expect(lirr.check?.(partial, served)).toEqual([
      '2 routes with trips, minimum 6',
      '2 routes, under half of the 12 served',
    ]);
  });

  it('downloads the railroad files the MTA lists, without a key', () => {
    expect(
      railTimetableSources.map((source) => source.request({ credentials: {}, now: RECEIVED_AT })),
    ).toEqual([
      { url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip' },
      { url: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip' },
    ]);
  });
});
