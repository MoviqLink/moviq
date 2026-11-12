import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import {
  gtfsIndexSchema,
  type GtfsIndex,
} from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { timetableInput } from '../../../src/modules/journeys/engine/timetable-input.js';
import { CAPTURED_AT, accepted, capture, storedAndRead, text } from './captures.js';

const decoder = new TextDecoder();

function tables(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(capture('gtfs_subway.zip'))).map(([name, data]) => [
      name,
      decoder.decode(data),
    ]),
  );
}

function zipped(content: Record<string, string>): Uint8Array {
  const entries = Object.fromEntries(Object.entries(content).map(([name, t]) => [name, text(t)]));
  return zipSync(entries, { mtime: new Date(2026, 6, 31) });
}

function parse(body: Uint8Array) {
  const subway = gtfsStaticSources[0];
  if (!subway) throw new Error('no subway timetable source');
  return subway.parse(body, { receivedAt: CAPTURED_AT, previous: undefined });
}

function index(body: Uint8Array): GtfsIndex {
  return gtfsIndexSchema.parse(accepted(parse(body)).data);
}

function columns(body: Uint8Array) {
  const input = timetableInput(index(body));
  if (!input.ok) throw new Error(input.detail);
  return input.timetable.stopTimes;
}

/** Each trip's calls as `stop arrival departure flags`, read back from the columns. */
function callsByTrip(body: Uint8Array): Record<string, string[]> {
  const stopTimes = columns(body);
  return Object.fromEntries(
    stopTimes.trips.map((trip, at) => {
      const calls: string[] = [];
      for (let call = stopTimes.tripStart[at] ?? 0; call < (stopTimes.tripStart[at + 1] ?? 0);) {
        const stop = stopTimes.stops[stopTimes.stop[call] ?? -1] ?? '';
        const times = `${String(stopTimes.arrival[call])} ${String(stopTimes.departure[call])}`;
        calls.push(`${stop} ${times} ${String(stopTimes.flags[call])}`);
        call += 1;
      }
      return [trip, calls];
    }),
  );
}

function seconds(clock: string): number {
  const [hours = 0, minutes = 0, secs = 0] = clock.split(':').map(Number);
  return hours * 3600 + minutes * 60 + secs;
}

/** The capture's `stop_times.txt` read with nothing but `split`: what the index must hold. */
function expectedCalls(stopTimes: string): Record<string, string[]> {
  const [header = '', ...rows] = stopTimes.trimEnd().split('\n');
  const names = header.trim().split(',');
  const at = (name: string) => names.indexOf(name);
  const byTrip: Record<string, [number, string][]> = {};
  for (const row of rows) {
    const cells = row.trim().split(',');
    const cell = (name: string) => cells[at(name)] ?? '';
    const flags = (cell('pickup_type') === '1' ? 1 : 0) | (cell('drop_off_type') === '1' ? 2 : 0);
    const times = [seconds(cell('arrival_time')), seconds(cell('departure_time')), flags];
    const call = `${cell('stop_id')} ${times.map(String).join(' ')}`;
    (byTrip[cell('trip_id')] ??= []).push([Number(cell('stop_sequence')), call]);
  }
  return Object.fromEntries(
    Object.entries(byTrip).map(([trip, calls]) => [
      trip,
      calls.sort((a, b) => a[0] - b[0]).map(([, call]) => call),
    ]),
  );
}

function withStopTimes(edit: (rows: string[]) => string[]): Uint8Array {
  const content = tables();
  const [header = '', ...rows] = (content['stop_times.txt'] ?? '').trimEnd().split('\n');
  content['stop_times.txt'] = [header, ...edit(rows)].join('\n');
  return zipped(content);
}

describe('GTFS stop times and transfers in the index', () => {
  it('keeps every call of the capture, as its stop_times.txt says, and counts them', () => {
    const body = capture('gtfs_subway.zip');
    expect(callsByTrip(body)).toEqual(expectedCalls(tables()['stop_times.txt'] ?? ''));
    expect(accepted(parse(body)).coverage).toMatch(/, 65 shapes, 137 stop times, 0 transfers$/);
    expect(storedAndRead('mta-gtfs-subway', index(body))).toEqual(index(body));
  });

  it('puts calls in stop_sequence order, also for a trip whose rows come back later', () => {
    const sorted = callsByTrip(capture('gtfs_subway.zip'));
    expect(callsByTrip(withStopTimes((rows) => [...rows].reverse()))).toEqual(sorted);
    const split = withStopTimes((rows) => [...rows.slice(5), ...rows.slice(0, 5)]);
    expect(callsByTrip(split)).toEqual(sorted);
  });

  it.each<[string, (rows: string[]) => string[], string]>([
    ['a repeated stop_sequence', (rows) => [...rows, rows[0] ?? ''], 'repeats stop_sequence'],
    [
      'a repeated stop_sequence in one run',
      (rows) => [rows[0] ?? '', rows[0] ?? '', ...rows.slice(1)],
      'repeats stop_sequence',
    ],
    [
      'a time that is not H:MM:SS',
      (rows) => [(rows[0] ?? '').replace(/:(\d\d),/, ':$1.5,'), ...rows.slice(1)],
      'row 2',
    ],
    [
      'a stop_sequence that is not a number',
      (rows) => [(rows[0] ?? '').replace(/,(\d+)$/, ',x'), ...rows.slice(1)],
      'stop_sequence',
    ],
  ])('refuses %s as an invalid row', (_, edit, detail) => {
    const result = parse(withStopTimes(edit));
    expect(result).toMatchObject({ ok: false, code: 'invalid-row' });
    expect(result.ok ? '' : result.detail).toContain(detail);
  });

  it('refuses stop times or transfers that name a trip or stop the file lacks', () => {
    const unknownTrip = withStopTimes((rows) => [...rows, 'GHOST,101N,00:00:00,00:00:00,1']);
    expect(parse(unknownTrip)).toMatchObject({ ok: false, code: 'broken-reference' });
    const content = tables();
    content['transfers.txt'] =
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n101,999,2,180';
    const result = parse(zipped(content));
    expect(result.ok ? '' : result.detail).toContain('transfers.txt names stop 999');
  });

  it('reads transfers between stops and leaves out the in-seat types 4 and 5', () => {
    const content = tables();
    content['transfers.txt'] =
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n' +
      '127,725,2,180\n101,101,0,\n127,127,4,\n725,127,3,';
    expect(index(zipped(content)).transfers).toEqual([
      { from: '127', to: '725', type: 2, minSeconds: 180 },
      { from: '101', to: '101', type: 0, minSeconds: null },
      { from: '725', to: '127', type: 3, minSeconds: null },
    ]);
  });

  it('reads wheelchair_boarding when a file has it, and leaves a stop without it', () => {
    const content = tables();
    const [header = '', ...rows] = (content['stops.txt'] ?? '').trimEnd().split('\n');
    content['stops.txt'] = [
      `${header.trim()},wheelchair_boarding`,
      ...rows.map((row, at) => `${row.trim()},${['1', '2', '0', ''][at % 4] ?? ''}`),
    ].join('\n');
    const { stops } = index(zipped(content));
    const firstIds = rows.slice(0, 4).map((row) => row.split(',')[0] ?? '');
    expect(firstIds.map((id) => stops[id]?.wheelchairBoarding)).toEqual([
      1,
      2,
      undefined,
      undefined,
    ]);
  });

  it('decodes the columns for the engine once, when it first reads them', () => {
    const input = timetableInput(index(capture('gtfs_subway.zip')));
    if (!input.ok) throw new Error(input.detail);
    const first = input.timetable.stopTimes;
    expect(input.timetable.stopTimes).toBe(first);
    expect(first.stop).toHaveLength(137);
  });

  it('still reads a version stored before stop times, and says the engine cannot use it', () => {
    const {
      stopTimes: _stopTimes,
      transfers: _transfers,
      ...old
    } = index(capture('gtfs_subway.zip'));
    expect(storedAndRead('mta-gtfs-subway', old)).toEqual(old);
    expect(timetableInput(old)).toEqual({
      ok: false,
      detail: 'The version served was stored without its stop times.',
    });
  });

  it('refuses stored stop times whose calls do not decode', () => {
    const served = index(capture('gtfs_subway.zip'));
    const stopTimes = served.stopTimes ?? { stops: [], trips: [], calls: '' };
    const cut = { ...served, stopTimes: { ...stopTimes, calls: stopTimes.calls.slice(0, -1) } };
    expect(timetableInput(cut)).toMatchObject({ ok: false });
    const fewerStops = {
      ...served,
      stopTimes: { ...stopTimes, stops: stopTimes.stops.slice(0, 1) },
    };
    expect(timetableInput(fewerStops)).toMatchObject({ ok: false });
  });
});
