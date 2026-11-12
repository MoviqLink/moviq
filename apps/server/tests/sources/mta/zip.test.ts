import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { readZipTables, zipEnvelope } from '../../../src/modules/data-platform/sources/mta/zip.js';
import { text } from './captures.js';

describe('ZIP tables', () => {
  it('streams a table far larger than one piece of the archive, every record whole', () => {
    const rows = Array.from(
      { length: 200_000 },
      (_, at) => `trip-${String(at % 997)},${String(at)}`,
    );
    const body = zipSync({ 'stop_times.txt': text(['trip_id,stop_sequence', ...rows].join('\n')) });
    const envelope = zipEnvelope(body);
    if (!envelope.ok) throw new Error(envelope.detail);
    let records = 0;
    let broken = 0;
    const read = readZipTables(
      body,
      envelope.sizes,
      new Map([
        [
          'stop_times.txt',
          (fields: readonly string[]) => {
            if (records > 0 && fields[1] !== String(records - 1)) broken += 1;
            records += 1;
          },
        ],
      ]),
    );
    expect(read).toEqual({ ok: true });
    expect(body.length).toBeGreaterThan(64 * 1024);
    expect({ records, broken }).toEqual({ records: 200_001, broken: 0 });
  });
});
