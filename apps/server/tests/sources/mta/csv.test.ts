import { describe, expect, it } from 'vitest';

import {
  csvReader,
  csvRecords,
  detached,
  type CsvRow,
} from '../../../src/modules/data-platform/sources/mta/csv.js';

function read(pieces: readonly string[]): CsvRow[] {
  const rows: CsvRow[] = [];
  const reader = csvReader((row) => rows.push(row));
  for (const piece of pieces) reader.write(piece);
  reader.end();
  return rows;
}

describe('streaming CSV', () => {
  const table =
    '﻿route_id,route_desc,route_color\r\n' +
    'A,"Inwood, Manhattan to ""Far"" Rockaway",0062CF\r\n' +
    'B,"Two\nlines",FF6319\r\n' +
    'C,  spaced  ,\r\n' +
    'D,no break at the end';

  const expected = [
    { route_id: 'A', route_desc: 'Inwood, Manhattan to "Far" Rockaway', route_color: '0062CF' },
    { route_id: 'B', route_desc: 'Two\nlines', route_color: 'FF6319' },
    { route_id: 'C', route_desc: 'spaced', route_color: '' },
    { route_id: 'D', route_desc: 'no break at the end', route_color: '' },
  ];

  it('reads quotes, escaped quotes, line breaks in fields, CRLF, a BOM and a last open row', () => {
    expect(read([table])).toEqual(expected);
  });

  it('gives the same rows whatever the pieces the text arrives in', () => {
    const pieces = Array.from({ length: table.length }, (_, at) => table.slice(at, at + 1));
    expect(read(pieces)).toEqual(expected);
  });
});

describe('streaming CSV records', () => {
  it('passes the header and each record, and keeps a quoted line break across pieces', () => {
    const seen: string[][] = [];
    const reader = csvRecords((fields) => seen.push([...fields]));
    for (const piece of ['trip_id,stop_id\r\n1,"A\n', 'B"\r\n2,C\r', '\n3,D\re'])
      reader.write(piece);
    reader.end();
    expect(seen).toEqual([
      ['trip_id', 'stop_id'],
      ['1', 'A\nB'],
      ['2', 'C'],
      ['3', 'De'],
    ]);
  });

  it('copies a field without changing it', () => {
    const field = 'AFA26GEN-1095-Weekday-00_115550_1..N03R';
    expect(detached(field.slice(3, 30))).toBe(field.slice(3, 30));
  });
});
