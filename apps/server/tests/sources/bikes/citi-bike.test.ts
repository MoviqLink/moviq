import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  citiBikeStationsSource,
  citiBikeStatusSource,
  type CitiBikeStations,
  type CitiBikeStatus,
} from '../../../src/modules/data-platform/sources/bikes/citi-bike.js';
import { accepted, capture, captureJson, json, storedAndRead, text } from '../regional/captures.js';

/** Both files were downloaded at 02:29:27 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:29:30Z');

const envelopeShape = z.looseObject({
  last_updated: z.number(),
  data: z.object({ stations: z.array(z.looseObject({})) }),
});

function envelope(file: string): z.infer<typeof envelopeShape> {
  return envelopeShape.parse(captureJson('bikes', file));
}

function parseStations(body: Uint8Array) {
  return citiBikeStationsSource.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

function parseStatus(body: Uint8Array) {
  return citiBikeStatusSource.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

/** The accepted captures, typed by reading them through their schemas. */
function readStations(): CitiBikeStations {
  const body = capture('bikes', 'citi-bike-station-information.json');
  return citiBikeStationsSource.dataSchema.parse(accepted(parseStations(body)).data);
}

function readStatus(): CitiBikeStatus {
  const body = capture('bikes', 'citi-bike-station-status.json');
  return citiBikeStatusSource.dataSchema.parse(accepted(parseStatus(body)).data);
}

describe('Citi Bike stations and status', () => {
  it('accepts the station capture, with a place and docks for each station', () => {
    const result = accepted(parseStations(capture('bikes', 'citi-bike-station-information.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:29:04.000Z');
    expect(result.coverage).toBe('12 stations, 0 left out');
    expect(storedAndRead(citiBikeStationsSource, result.data)).toEqual(result.data);
    const data = citiBikeStationsSource.dataSchema.parse(result.data);
    expect(data.stations[0]).toEqual({
      stationId: '66dc292c-0aca-11e7-82f6-3863bb44ef7c',
      name: 'Broadway & W 41 St',
      shortName: '6560.01',
      latitude: 40.75513557,
      longitude: -73.98658032,
      capacity: 55,
    });
  });

  it('accepts the status capture, counted by station and joined to the stations', () => {
    const result = accepted(parseStatus(capture('bikes', 'citi-bike-station-status.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:28:05.000Z');
    expect(result.coverage).toBe('12 stations, 8 renting, 0 left out');
    expect(storedAndRead(citiBikeStatusSource, result.data)).toEqual(result.data);
    const status = citiBikeStatusSource.dataSchema.parse(result.data);
    const stations = readStations();
    const placed = new Set(stations.stations.map((station) => station.stationId));
    for (const station of status.stations) {
      expect(station.located).toBe('station');
      expect(placed.has(station.stationId)).toBe(true);
      expect(station.ebikes).toBeLessThanOrEqual(station.bikes);
    }
  });

  it('reads the 86400 of a station that never reported as no report', () => {
    const status = readStatus();
    // Three stations are not installed: two never reported, one last did on 29/10/2026.
    const removed = status.stations.filter((station) => !station.installed);
    expect(removed.map((station) => station.reportedAt)).toEqual([
      null,
      null,
      '2026-10-29T13:42:46.000Z',
    ]);
    const installed = status.stations.filter((station) => station.installed);
    for (const station of installed) expect(station.reportedAt).not.toBeNull();
  });

  it('leaves out and counts a row that does not validate', () => {
    const changed = envelope('citi-bike-station-status.json');
    const [first] = changed.data.stations;
    if (first) first['num_docks_available'] = -1;
    expect(accepted(parseStatus(json(changed))).coverage).toBe(
      '11 stations, 8 renting, 1 left out',
    );
  });

  it.each([
    ['not-json', text('<html><body>502 Bad Gateway</body></html>')],
    ['unexpected-shape', json({ data: { stations: [] } })],
    [
      'future-update',
      json({ ...envelope('citi-bike-station-status.json'), last_updated: 1794365000 }),
    ],
  ])('refuses %s', (code, body) => {
    expect(parseStatus(body)).toMatchObject({ ok: false, code });
    expect(parseStations(body)).toMatchObject({ ok: false, code });
  });

  it('checks the size of the system, a drop and the order of versions', () => {
    const status = readStatus();
    const [first] = status.stations;
    if (!first) throw new Error('no station in the capture');
    const fuller: CitiBikeStatus = {
      ...status,
      stations: Array.from({ length: 2_519 }, () => first),
    };
    expect(citiBikeStatusSource.check?.(status, undefined)).toEqual([
      'too-few-stations: 12 stations, minimum 1,260 stations',
    ]);
    expect(citiBikeStatusSource.check?.(fuller, undefined)).toEqual([]);
    const newer = { ...fuller, updatedAt: '2026-11-11T02:40:00.000Z' };
    expect(citiBikeStatusSource.check?.(status, newer)).toEqual([
      'older-than-served: the candidate is from 2026-11-11T02:28:05.000Z, the ' +
        'served data from 2026-11-11T02:40:00.000Z',
      'too-few-stations: 12 stations, minimum 1,260 stations',
      'coverage-drop: 12 stations, 2519 before',
    ]);
  });

  it('asks Lyft for the New York GBFS 2.3 files in English', () => {
    expect(citiBikeStationsSource.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
    );
    expect(citiBikeStatusSource.request({ credentials: {}, now: RECEIVED_AT }).url).toBe(
      'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_status.json',
    );
  });
});
