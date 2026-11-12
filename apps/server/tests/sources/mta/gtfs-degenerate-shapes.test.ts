import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import type { GtfsIndex } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { CAPTURED_AT, accepted, capture, storedAndRead } from './captures.js';

function parseSubway(body: Uint8Array) {
  const subway = gtfsStaticSources[0];
  if (subway === undefined) throw new Error('The subway source is missing.');
  return subway.parse(body, { receivedAt: CAPTURED_AT, previous: undefined });
}

/** A real timetable with a single-point placeholder like those in the Metro-North export. */
function withDegenerateShape(used: boolean): Uint8Array {
  const tables = unzipSync(capture('gtfs_subway.zip'));
  const [header = '', ...rows] = new TextDecoder()
    .decode(tables['shapes.txt'])
    .trimEnd()
    .split('\n');
  tables['shapes.txt'] = new TextEncoder().encode(
    (used
      ? [header, ...rows.filter((row) => !row.startsWith('A..S74R,')), 'A..S74R,0,40.7,-74.0']
      : [header, ...rows, 'LONE,0,40.7,-74.0']
    ).join('\n'),
  );
  return zipSync(tables, { mtime: new Date(2026, 6, 31) });
}

describe('degenerate GTFS shapes', () => {
  it.each([false, true])(
    'keeps valid timetables when a single-point shape is present (used by trips: %s)',
    (used) => {
      const original = accepted(parseSubway(capture('gtfs_subway.zip'))).data as GtfsIndex;
      const body = withDegenerateShape(used);
      const parsed = accepted(parseSubway(body));
      const index = parsed.data as GtfsIndex;
      expect(index.routes).toEqual(original.routes);
      expect(index.stops).toEqual(original.stops);
      expect(index.stopTimes).toEqual(original.stopTimes);
      expect(index.shapes?.[used ? 'A..S74R' : 'LONE']).toBeUndefined();
      expect(parsed.coverage).toContain('1 single-point shape omitted');
      for (const [id, trip] of Object.entries(original.trips)) {
        expect(index.trips[id]).toEqual(
          used && trip.shape === 'A..S74R' ? { ...trip, shape: null } : trip,
        );
      }
      expect(storedAndRead('mta-gtfs-subway', index)).toEqual(index);
    },
  );
});
