import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { alertsFeedSchema } from '../../../src/modules/data-platform/sources/mta/alerts.js';
import { accepted, capture, parseFresh, storedAndRead, text } from './captures.js';

const HEADER_TIME = Math.floor(Date.parse('2026-11-11T01:02:52Z') / 1000);

function feed(entity: unknown[], timestamp = HEADER_TIME): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '2.0', incrementality: 'FULL_DATASET', timestamp },
    entity,
  });
}

function alert(language: string, routeId?: string): unknown {
  return {
    id: 'a',
    alert: {
      informed_entity: routeId === undefined ? [] : [{ agency_id: 'MTASBWY', route_id: routeId }],
      header_text: { translation: [{ text: '<p>Delays</p>', language }] },
    },
  };
}

describe('MTA service alerts', () => {
  it('accepts the capture at the header time, with plain English text', () => {
    const result = accepted(parseFresh('mta-alerts', capture('alerts.pb')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T01:02:52.000Z');
    expect(result.coverage).toBe('20 alerts, 0 left out');
    expect(storedAndRead('mta-alerts', result.data)).toEqual(result.data);
    const { alerts } = alertsFeedSchema.parse(result.data);
    expect(alerts.every((item) => !item.header.includes('<p>'))).toBe(true);
    const agencies = new Set(
      alerts.flatMap((item) => item.affected.map((entity) => entity.agencyId)),
    );
    expect([...agencies].sort()).toEqual(['LI', 'MNR', 'MTA NYCT', 'MTABC', 'MTASBWY']);
    expect(alerts.some((item) => item.affected.some((entity) => entity.stopId !== null))).toBe(
      true,
    );
    expect(alerts.some((item) => item.activePeriods.length === 8)).toBe(true);
  });

  it('keeps open periods open instead of inventing an end', () => {
    const body = feed([
      {
        id: 'open',
        alert: {
          active_period: [{ start: HEADER_TIME - 600 }],
          informed_entity: [{ agency_id: 'MTASBWY', route_id: 'A' }],
          header_text: { translation: [{ text: 'A trains are delayed', language: 'en' }] },
        },
      },
    ]);
    const { alerts } = alertsFeedSchema.parse(accepted(parseFresh('mta-alerts', body)).data);
    expect(alerts[0]?.activePeriods).toEqual([{ start: '2026-11-11T00:52:52.000Z', end: null }]);
    expect(alerts[0]?.cause).toBeNull();
  });

  it.each([
    ['not-protobuf', text('<html>Service Unavailable</html>')],
    ['no-header-time', feed([alert('en', 'A')], 0)],
    ['future-header', feed([alert('en', 'A')], HEADER_TIME + 3_600)],
    ['empty-feed', feed([])],
    ['empty-feed', feed([alert('en-html', 'A')])],
    ['empty-feed', feed([alert('en')])],
  ])('refuses %s', (code, body) => {
    expect(parseFresh('mta-alerts', body)).toMatchObject({ ok: false, code });
  });
});
