import { describe, expect, it } from 'vitest';

import { encodeGtfsRealtime } from '../../../src/modules/data-platform/formats/gtfs-realtime.js';
import { ferrySources } from '../../../src/modules/data-platform/sources/ferries/index.js';
import { alertsFeedSchema } from '../../../src/modules/data-platform/sources/mta/alerts.js';
import { gtfsIndexSchema } from '../../../src/modules/data-platform/sources/mta/gtfs-static-schema.js';
import { accepted, capture, findSource, storedAndRead, text } from '../regional/captures.js';

/** Both alert captures were downloaded at 03:59:04 and 03:59:06 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:59:06Z');
const HEADER_TIME = Math.floor(Date.parse('2026-11-11T03:58:00Z') / 1000);

const operators = [
  ['nyc-ferry-alerts', 'nyc-ferry-alerts.pb', 'nyc-ferry-gtfs', 'nyc-ferry-gtfs.zip'],
  ['ny-waterway-alerts', 'ny-waterway-alerts.pb', 'ny-waterway-gtfs', 'ny-waterway-gtfs.zip'],
] as const;

function parse(id: string, body: Uint8Array, previous?: unknown) {
  return findSource(ferrySources, id).parse(body, { receivedAt: RECEIVED_AT, previous });
}

function feed(entity: unknown[], header: Record<string, unknown> = {}): Uint8Array {
  return encodeGtfsRealtime({
    header: { gtfs_realtime_version: '2.0', timestamp: HEADER_TIME, ...header },
    entity,
  });
}

function timetableOf(id: string, file: string) {
  return gtfsIndexSchema.parse(accepted(parse(id, capture('ferries', file))).data);
}

const english = (value: string) => ({ translation: [{ text: value, language: 'en' }] });

describe('NYC Ferry and NY Waterway service alerts', () => {
  it.each(operators)('%s accepts its empty capture as 0 alerts, not as a failure', (id, file) => {
    const result = accepted(parse(id, capture('ferries', file)));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:58:00.000Z');
    expect(result.coverage).toBe('0 alerts, 0 left out');
    expect(storedAndRead(findSource(ferrySources, id), result.data)).toEqual(result.data);
  });

  it.each(operators)(
    '%s keeps the GTFS ids of what an alert affects, so they join the timetable',
    (id, _file, timetableId, timetableFile) => {
      const timetable = timetableOf(timetableId, timetableFile);
      const [routeId] = Object.keys(timetable.routes);
      const [stopId] = Object.keys(timetable.stops);
      const body = feed([
        {
          id: 'closure',
          alert: {
            active_period: [{ start: HEADER_TIME, end: HEADER_TIME + 3_600 }],
            informed_entity: [{ route_id: routeId }, { stop_id: stopId }, { route_id: 'R-0' }],
            cause: 'WEATHER',
            effect: 'NO_SERVICE',
            header_text: english('Service suspended'),
            description_text: english('High winds on the harbor.'),
          },
        },
      ]);
      const [alert] = alertsFeedSchema.parse(accepted(parse(id, body)).data).alerts;
      expect(alert).toMatchObject({
        id: 'closure',
        cause: 'WEATHER',
        effect: 'NO_SERVICE',
        header: 'Service suspended',
        description: 'High winds on the harbor.',
        activePeriods: [{ start: '2026-11-11T03:58:00.000Z', end: '2026-11-11T04:58:00.000Z' }],
      });
      const affected = alert?.affected ?? [];
      expect(timetable.routes[affected[0]?.routeId ?? '']).toBeDefined();
      expect(timetable.stops[affected[1]?.stopId ?? '']).toBeDefined();
      // An id the timetable does not know is kept as published, and the join finds nothing.
      expect(affected[2]?.routeId).toBe('R-0');
      expect(timetable.routes['R-0']).toBeUndefined();
    },
  );

  it('leaves out and counts an alert without text or without anything it affects', () => {
    const body = feed([
      { id: 'silent', alert: { informed_entity: [{ route_id: 'x' }] } },
      { id: 'nowhere', alert: { header_text: english('Delays') } },
      {
        id: 'kept',
        alert: { informed_entity: [{ agency_id: 'NYCF' }], header_text: english('Ok') },
      },
    ]);
    const result = accepted(parse('nyc-ferry-alerts', body));
    expect(result.coverage).toBe('1 alerts, 2 left out');
  });

  it.each([
    ['not-protobuf', text('<html>Server Error</html>')],
    ['no-header-time', feed([], { timestamp: 0 })],
    ['future-header', feed([], { timestamp: HEADER_TIME + 3_600 })],
    ['differential-feed', feed([], { incrementality: 'DIFFERENTIAL' })],
  ])('refuses %s', (code, body) => {
    expect(parse('ny-waterway-alerts', body)).toMatchObject({ ok: false, code });
  });

  it('refuses a feed older than the one served', () => {
    const served = accepted(parse('nyc-ferry-alerts', feed([]))).data;
    const older = feed([], { timestamp: HEADER_TIME - 120 });
    expect(parse('nyc-ferry-alerts', older, served)).toMatchObject({ code: 'older-than-served' });
  });

  it('asks each Connexionz host for its alert feed, without a key', () => {
    const urls = operators.map(
      ([id]) => findSource(ferrySources, id).request({ credentials: {}, now: RECEIVED_AT }).url,
    );
    expect(urls).toEqual([
      'https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert',
      'https://nywaterway.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/alert',
    ]);
  });
});
