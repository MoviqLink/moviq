import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { mtaAlerts } from '../../../src/modules/data-platform/sources/mta/alerts.js';
import { busSources } from '../../../src/modules/data-platform/sources/mta/bus-realtime.js';
import { subwaySources } from '../../../src/modules/data-platform/sources/mta/subway-realtime.js';
import { accepted, parseFresh, source } from './captures.js';

const HEADER_TIME = Math.floor(Date.parse('2026-11-11T01:05:00Z') / 1000);

const trip = { trip_id: '109850_A..N55R', route_id: 'A', start_date: '20261110' };

/** One entity of each kind, so every GTFS Realtime source of the MTA has something to keep. */
const entity = [
  {
    id: 'trip',
    trip_update: {
      trip,
      stop_time_update: [{ stop_id: 'A06N', arrival: { time: HEADER_TIME + 60 } }],
    },
  },
  {
    id: 'vehicle',
    vehicle: {
      trip,
      position: { latitude: 40.847391, longitude: -73.939704 },
      timestamp: HEADER_TIME,
    },
  },
  {
    id: 'alert',
    alert: {
      informed_entity: [{ agency_id: 'MTASBWY', route_id: 'A' }],
      header_text: { translation: [{ text: 'A trains are delayed', language: 'en' }] },
    },
  },
];

function feed(incrementality?: 'FULL_DATASET' | 'DIFFERENTIAL'): Uint8Array {
  const header = { gtfs_realtime_version: '2.0', timestamp: HEADER_TIME };
  return encodeGtfsRealtime({
    header: incrementality === undefined ? header : { ...header, incrementality },
    entity,
  });
}

const realtimeIds = [...subwaySources, ...busSources, mtaAlerts].map((definition) => definition.id);

describe('MTA GTFS Realtime incrementality', () => {
  it('covers the 8 subway feeds, the 2 Bus Time feeds and the alerts', () => {
    expect(realtimeIds).toHaveLength(11);
  });

  it.each(realtimeIds)('%s reads a full dataset, whether the header says so or not', (id) => {
    for (const body of [feed(), feed('FULL_DATASET')]) {
      expect(accepted(parseFresh(id, body)).dataTime.toISOString()).toBe(
        '2026-11-11T01:05:00.000Z',
      );
    }
  });

  it.each(realtimeIds)('%s refuses a differential feed and lists the refusal', (id) => {
    expect(parseFresh(id, feed('DIFFERENTIAL'))).toMatchObject({
      ok: false,
      code: 'differential-feed',
    });
    expect(source(id).failures.map((failure) => failure.code)).toContain('differential-feed');
  });
});
