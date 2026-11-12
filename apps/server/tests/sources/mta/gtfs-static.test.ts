import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import type { GtfsIndex } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { decodePolyline } from '../../../src/modules/data-platform/sources/mta/polyline.js';
import { CAPTURED_AT, accepted, capture, storedAndRead, text } from './captures.js';

const subway = gtfsStaticSources[0];
const decoder = new TextDecoder();

function parseSubway(body: Uint8Array, receivedAt = CAPTURED_AT, previous?: GtfsIndex) {
  if (!subway) throw new Error('no subway timetable source');
  return subway.parse(body, { receivedAt, previous });
}

function subwayIndex(): GtfsIndex {
  const result = parseSubway(capture('gtfs_subway.zip'));
  if (!result.ok) throw new Error(result.code);
  return result.data;
}

/** The subway capture rebuilt with some tables changed or removed, dated 31/07/2026 inside. */
function rebuilt(
  file: string,
  change: (tables: Record<string, string>) => void,
  modified = new Date(2026, 6, 31),
): Uint8Array {
  const tables = Object.fromEntries(
    Object.entries(unzipSync(capture(file))).map(([name, data]) => [name, decoder.decode(data)]),
  );
  change(tables);
  const entries = Object.fromEntries(
    Object.entries(tables).map(([name, content]) => [name, text(content)] as const),
  );
  return zipSync(entries, { mtime: modified });
}

function editLines(content: string | undefined, edit: (cells: string[]) => string[]): string {
  const [header = '', ...rows] = (content ?? '').trimEnd().split('\n');
  return [header, ...rows.map((row) => edit(row.split(',')).join(','))].join('\n');
}

describe('MTA static timetables', () => {
  const expected = [
    ['mta-gtfs-subway', 'gtfs_subway.zip', '2026-10-28', '29 routes, 496 stations, 1,488 stops'],
    ['mta-gtfs-bus-brooklyn', 'gtfs_b.zip', '2026-10-09', '68 routes, 0 stations, 4,575 stops'],
    ['mta-gtfs-bus-bronx', 'gtfs_bx.zip', '2026-10-09', '46 routes, 0 stations, 1,890 stops'],
    ['mta-gtfs-bus-manhattan', 'gtfs_m.zip', '2026-10-09', '41 routes, 0 stations, 1,823 stops'],
    ['mta-gtfs-bus-queens', 'gtfs_q.zip', '2026-10-09', '40 routes, 0 stations, 1,422 stops'],
    [
      'mta-gtfs-bus-staten-island',
      'gtfs_si.zip',
      '2026-10-09',
      '58 routes, 0 stations, 1,965 stops',
    ],
    ['mta-gtfs-bus-company', 'gtfs_busco.zip', '2026-10-12', '92 routes, 0 stations, 2,758 stops'],
  ] as const;

  it.each(expected)('%s accepts its capture, dated by feed_version', (id, file, day, counts) => {
    const definition = gtfsStaticSources.find((candidate) => candidate.id === id);
    const result = accepted(
      definition?.parse(capture(file), { receivedAt: CAPTURED_AT, previous: undefined }) ?? {
        ok: false,
        code: 'missing',
        detail: id,
      },
    );
    // Midnight in New York of the date that starts feed_version.
    expect(result.dataTime.toISOString()).toBe(`${day}T04:00:00.000Z`);
    expect(result.coverage.startsWith(counts)).toBe(true);
    expect(definition?.check?.(result.data as GtfsIndex, undefined)).toEqual([]);
    expect(storedAndRead(id, result.data)).toEqual(result.data);
  });

  it('indexes routes, stations with their platforms, trips and calendars', () => {
    const index = subwayIndex();
    expect(index.routes['A']).toMatchObject({ shortName: 'A', type: 1, color: '0062CF' });
    expect(index.stops['101']).toMatchObject({ name: 'Van Cortlandt Park-242 St', station: true });
    expect(index.stops['101N']).toMatchObject({ parent: '101', station: false });
    const trip = Object.values(index.trips)[0];
    expect(trip?.headsign).not.toBeNull();
    expect(index.services['Sunday']?.added).toContain('20261126');
  });

  it('indexes each shape as a polyline in sequence order, and the shape of each trip', () => {
    const index = subwayIndex();
    // The capture keeps the 65 shapes its trips and its live trains need.
    expect(Object.keys(index.shapes ?? {})).toHaveLength(65);
    const trip = Object.values(index.trips).find((candidate) => candidate.shape === 'A..S74R');
    expect(trip).toMatchObject({ route: 'A', headsign: 'Far Rockaway-Mott Av' });
    const points = decodePolyline(index.shapes?.['A..S74R'] ?? '') ?? [];
    // Its 1,132 points from Inwood-207 St (sequence 0) to Far Rockaway (sequence 1131), rounded to
    // five decimals: 40.868072, -73.919899 and 40.603995, -73.755405 in the file.
    expect(points).toHaveLength(1_132);
    expect(points[0]).toEqual({ lat: 40.86807, lon: -73.9199 });
    expect(points.at(-1)).toEqual({ lat: 40.60399, lon: -73.7554 });
  });

  it('sorts the points of a shape by their sequence, whatever their order in the file', () => {
    const body = rebuilt('gtfs_subway.zip', (tables) => {
      const [header = '', ...rows] = (tables['shapes.txt'] ?? '').trimEnd().split('\n');
      tables['shapes.txt'] = [header, ...rows.reverse()].join('\n');
    });
    expect((accepted(parseSubway(body)).data as GtfsIndex).shapes).toEqual(subwayIndex().shapes);
  });

  it.each<[string, string, (rows: string[]) => string[]]>([
    [
      'repeats a point',
      'shape 1..N03R repeats point 1',
      (rows) => [rows[0] ?? '', rows[1] ?? '', ...rows.slice(1)],
    ],
  ])('refuses a shape that %s', (_, detail, edit) => {
    const body = rebuilt('gtfs_subway.zip', (tables) => {
      const [header = '', ...rows] = (tables['shapes.txt'] ?? '').trimEnd().split('\n');
      tables['shapes.txt'] = [header, ...edit(rows)].join('\n');
    });
    const result = parseSubway(body);
    expect(result).toMatchObject({ ok: false, code: 'invalid-row' });
    expect(result.ok ? '' : result.detail).toContain(detail);
  });

  it('refuses a trip that names a shape shapes.txt lacks, and admits a file without shapes.txt', () => {
    const cut = rebuilt('gtfs_subway.zip', (tables) => {
      const [header = '', ...rows] = (tables['shapes.txt'] ?? '').trimEnd().split('\n');
      tables['shapes.txt'] = [header, ...rows.filter((row) => !row.startsWith('A..S74R,'))].join(
        '\n',
      );
    });
    const refused = parseSubway(cut);
    expect(refused).toMatchObject({ ok: false, code: 'broken-reference' });
    expect(refused.ok ? '' : refused.detail).toContain('names shape A..S74R');
    const without = rebuilt('gtfs_subway.zip', (tables) => {
      delete tables['shapes.txt'];
    });
    const admitted = accepted(parseSubway(without));
    expect(admitted.coverage).toContain('0 shapes');
    expect((admitted.data as GtfsIndex).shapes).toEqual({});
  });

  it('still reads a version stored before shapes were indexed', () => {
    const { shapes: _shapes, ...stored } = subwayIndex();
    const trips = Object.fromEntries(
      Object.entries(stored.trips).map(([id, { shape: _shape, ...trip }]) => [id, trip]),
    );
    const old = { ...stored, trips };
    expect(storedAndRead('mta-gtfs-subway', old)).toEqual(old);
  });

  it.each([
    ['agency.txt', { ok: true }],
    ['stop_times.txt', { ok: false, code: 'corrupt-zip' }],
    ['trips.txt', { ok: false, code: 'corrupt-zip' }],
  ])('with the compressed data of %s broken, gives %o', (table, outcome) => {
    const body = rebuilt('gtfs_subway.zip', () => undefined);
    const name = text(table);
    // The first copy of the name is in the local header, right before the compressed data.
    const at = body.findIndex((_, index) =>
      name.every((byte, offset) => body[index + offset] === byte),
    );
    body.fill(0xff, at + name.length, at + name.length + 32);
    expect(parseSubway(body)).toMatchObject(outcome);
  });

  it.each<[string, (tables: Record<string, string>) => void]>([
    [
      'stop_times.txt is missing',
      (tables) => {
        delete tables['stop_times.txt'];
      },
    ],
    [
      'agency.txt is missing, stop_times.txt is missing',
      (tables) => {
        delete tables['agency.txt'];
        delete tables['stop_times.txt'];
      },
    ],
    [
      'stops.txt is empty',
      (tables) => {
        tables['stops.txt'] = '';
      },
    ],
    [
      'calendar.txt is missing and calendar_dates.txt is empty',
      (tables) => {
        delete tables['calendar.txt'];
        tables['calendar_dates.txt'] = '';
      },
    ],
  ])('refuses an archive where %s, read from its directory', (detail, change) => {
    const body = rebuilt('gtfs_subway.zip', change);
    expect(parseSubway(body)).toEqual({ ok: false, code: 'missing-file', detail });
  });

  it('accepts an empty calendar_dates.txt while calendar.txt gives the services', () => {
    const body = rebuilt('gtfs_subway.zip', (tables) => {
      tables['calendar_dates.txt'] = '';
    });
    expect(accepted(parseSubway(body)).coverage).toContain('29 routes');
  });

  it('refuses as corrupt a table the directory lists and the entries do not hold', () => {
    const body = rebuilt('gtfs_subway.zip', () => undefined);
    const name = text('trips.txt');
    // The first copy of the name is in the local header; the directory keeps the right one.
    const at = body.findIndex((_, index) =>
      name.every((byte, offset) => body[index + offset] === byte),
    );
    body.set(text('tripX'), at);
    expect(parseSubway(body)).toEqual({
      ok: false,
      code: 'corrupt-zip',
      detail: 'trips.txt is listed but not in the entries',
    });
  });

  it('refuses as corrupt a directory that holds fewer entries than it announces', () => {
    const body = rebuilt('gtfs_subway.zip', () => undefined);
    const signature = [0x50, 0x4b, 0x01, 0x02];
    const last = body.findLastIndex((_, index) =>
      signature.every((byte, offset) => body[index + offset] === byte),
    );
    body[last] = 0;
    expect(parseSubway(body)).toEqual({
      ok: false,
      code: 'corrupt-zip',
      detail: 'the central directory holds 8 of 9 entries',
    });
  });

  it('dates a file without feed_info.txt by the latest date inside the archive', () => {
    const body = rebuilt('gtfs_subway.zip', (tables) => {
      delete tables['feed_info.txt'];
    });
    expect(accepted(parseSubway(body)).dataTime.toISOString()).toBe('2026-07-31T04:00:00.000Z');
  });

  it.each([
    ['not-zip', text('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>')],
    ['truncated-zip', capture('gtfs_subway.zip').subarray(0, 12_000)],
    [
      'invalid-row',
      rebuilt('gtfs_subway.zip', (tables) => {
        tables['stops.txt'] = editLines(tables['stops.txt'], (cells) => [
          cells[0] ?? '',
          cells[1] ?? '',
          'north',
          ...cells.slice(3),
        ]);
      }),
    ],
    [
      'no-publication-time',
      rebuilt(
        'gtfs_m.zip',
        (tables) => {
          delete tables['feed_info.txt'];
        },
        new Date(1980, 0, 1),
      ),
    ],
    [
      'broken-reference',
      rebuilt('gtfs_subway.zip', (tables) => {
        tables['trips.txt'] = editLines(tables['trips.txt'], (cells) => ['Z9', ...cells.slice(1)]);
      }),
    ],
    [
      'no-service-today',
      rebuilt('gtfs_subway.zip', (tables) => {
        tables['calendar.txt'] = editLines(tables['calendar.txt'], (cells) => [
          cells[0] ?? '',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          '0',
          ...cells.slice(8),
        ]);
      }),
    ],
  ])('refuses %s', (code, body) => {
    expect(parseSubway(body)).toMatchObject({ ok: false, code });
  });

  it('refuses a file published after it was received', () => {
    const result = parseSubway(capture('gtfs_subway.zip'), new Date('2026-10-27T12:00:00Z'));
    expect(result).toMatchObject({ ok: false, code: 'future-publication' });
  });

  it('refuses a file older than the version served', () => {
    const served = {
      ...subwayIndex(),
      feed: { ...subwayIndex().feed, publishedAt: '2026-11-05T05:00:00.000Z' },
    };
    const result = parseSubway(capture('gtfs_subway.zip'), CAPTURED_AT, served);
    expect(result).toMatchObject({ ok: false, code: 'older-than-served' });
  });

  it.each([
    ['2026-10-30T15:00:00Z', 'starts on 20261101'],
    ['2027-05-20T15:00:00Z', 'ended on 20270515'],
  ])('refuses on %s, outside the feed dates', (receivedAt, detail) => {
    const result = parseSubway(capture('gtfs_subway.zip'), new Date(receivedAt));
    expect(result).toMatchObject({ ok: false, code: 'outside-feed-dates' });
    expect(result.ok ? '' : result.detail).toContain(detail);
  });

  it('refuses coverage under the minimum or under half of the version served', () => {
    const index = subwayIndex();
    const few = { ...index, routes: Object.fromEntries(Object.entries(index.routes).slice(0, 3)) };
    expect(subway?.check?.(few, undefined)).toEqual(['3 routes with trips, minimum 15']);
    const served = {
      ...index,
      trips: Object.fromEntries(
        [1, 2, 3].flatMap((copy) =>
          Object.entries(index.trips).map(([id, trip]) => [`${id}-${String(copy)}`, trip]),
        ),
      ),
    };
    expect(subway?.check?.(index, served)).toEqual(['58 trips, under half of the 174 served']);
  });
});
