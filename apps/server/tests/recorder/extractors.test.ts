import { describe, expect, it } from 'vitest';

import { unixSeconds, type ExtractedEvent } from '../../src/modules/recorder/events.js';
import type { Extractor, ExtractorSession } from '../../src/modules/recorder/extractor.js';
import { busExtractors } from '../../src/modules/recorder/extractors/bus.js';
import { recorderExtractors } from '../../src/modules/recorder/extractors/index.js';
import { fingerprintOf } from '../../src/modules/recorder/extractors/lifecycle.js';
import { subwayExtractors } from '../../src/modules/recorder/extractors/subway.js';

const s = (instant: string) => unixSeconds(instant);

function sessionOf(extractor: Extractor | undefined, open = new Map()): ExtractorSession {
  if (extractor === undefined) throw new Error('missing extractor');
  return extractor.start(open);
}

function run(session: ExtractorSession, data: unknown, at: string, previous?: string) {
  const result = session.extract(data, {
    version: `v-${at}`,
    dataTime: new Date(at),
    previousDataTime: previous === undefined ? undefined : new Date(previous),
  });
  if (!result.ok) throw new Error(result.why);
  return result.events;
}

const kinds = (events: readonly ExtractedEvent[]) => events.map((event) => event.k);

function subwayFeed(feedTime: string, stops: [string, string][], train: unknown) {
  return {
    feedTime,
    leftOut: 0,
    trips: [
      {
        tripId: 'T1',
        routeId: 'A',
        direction: 'north',
        startDate: '20261111',
        startTime: '06:00:00',
        stops: stops.map(([stopId, time]) => ({
          stopId,
          sequence: null,
          arrival: time,
          departure: time,
        })),
        train,
      },
    ],
  };
}

describe('the subway extractor', () => {
  it('records an arrival, then a departure inside its window with the time the feed gave', () => {
    const session = sessionOf(subwayExtractors[0]);
    const first = run(
      session,
      subwayFeed(
        '2026-11-11T12:00:00.000Z',
        [
          ['A06N', '2026-11-11T12:00:20.000Z'],
          ['A05N', '2026-11-11T12:02:00.000Z'],
          ['A03N', '2026-11-11T12:04:00.000Z'],
        ],
        { stopId: 'A06N', status: 'stopped', observedAt: '2026-11-11T11:59:50.000Z' },
      ),
      '2026-11-11T12:00:00.000Z',
    );
    expect(kinds(first)).toEqual(['train', 'stn', 'pred', 'pred', 'pred']);
    expect(first[1]).toMatchObject({ ev: 'arr', stop: 'A06N', next: 'A05N', exact: true });

    const second = run(
      session,
      subwayFeed(
        '2026-11-11T12:00:30.000Z',
        [
          ['A05N', '2026-11-11T12:02:05.000Z'],
          ['A03N', '2026-11-11T12:04:05.000Z'],
        ],
        { stopId: 'A05N', status: 'in-transit', observedAt: '2026-11-11T12:00:25.000Z' },
      ),
      '2026-11-11T12:00:30.000Z',
    );
    const departure = second.find((event) => event.k === 'stn');
    expect(departure).toMatchObject({
      ev: 'dep',
      stop: 'A06N',
      next: 'A05N',
      exact: true,
      t: s('2026-11-11T12:00:20.000Z'),
      lo: s('2026-11-11T12:00:00.000Z'),
      hi: s('2026-11-11T12:00:30.000Z'),
    });
    // A05N moved from the 2–5 min band to the 1–2 min band: one new sample; A03N stays in its band.
    expect(second.filter((event) => event.k === 'pred')).toMatchObject([{ stop: 'A05N' }]);
  });

  it('keeps only the window when the time the feed gave falls outside it', () => {
    const session = sessionOf(subwayExtractors[0]);
    run(
      session,
      subwayFeed(
        '2026-11-11T12:00:00.000Z',
        [
          ['A06N', '2026-11-11T11:58:00.000Z'],
          ['A05N', '2026-11-11T12:02:00.000Z'],
        ],
        null,
      ),
      '2026-11-11T12:00:00.000Z',
    );
    const events = run(
      session,
      subwayFeed('2026-11-11T12:00:30.000Z', [['A05N', '2026-11-11T12:02:00.000Z']], null),
      '2026-11-11T12:00:30.000Z',
    );
    expect(events.find((event) => event.k === 'stn')).toMatchObject({
      exact: false,
      t: s('2026-11-11T12:00:30.000Z'),
    });
  });

  it('deduces nothing when the first stop ahead was not ahead before', () => {
    const session = sessionOf(subwayExtractors[0]);
    run(
      session,
      subwayFeed('2026-11-11T12:00:00.000Z', [['A06N', '2026-11-11T12:01:00.000Z']], null),
      '2026-11-11T12:00:00.000Z',
    );
    const events = run(
      session,
      subwayFeed('2026-11-11T12:00:30.000Z', [['D14N', '2026-11-11T12:05:00.000Z']], null),
      '2026-11-11T12:00:30.000Z',
    );
    expect(events.filter((event) => event.k === 'stn')).toEqual([]);
  });
});

function busFeed(observedAt: string, latitude: number, stopId: string) {
  return {
    feedTime: observedAt,
    leftOut: 0,
    vehicles: [
      {
        vehicleId: 'MTA NYCT_1',
        tripId: 'TRIP-1',
        routeId: 'M15',
        direction: 0,
        startDate: '20261111',
        latitude,
        longitude: -73.98,
        bearing: 12.4,
        stopId,
        observedAt,
      },
    ],
  };
}

describe('the bus positions extractor', () => {
  it('writes positions only when they change, checkpoints while still, and passages', () => {
    const session = sessionOf(busExtractors[0]);
    const at = (seconds: number) =>
      new Date(Date.parse('2026-11-11T12:00:00.000Z') + seconds * 1000).toISOString();
    expect(kinds(run(session, busFeed(at(0), 40.75, '401'), at(0)))).toEqual(['assign', 'gps']);
    // 5 m further: the same place, not written.
    expect(run(session, busFeed(at(30), 40.75004, '401'), at(30))).toEqual([]);
    const held = run(session, busFeed(at(60), 40.75, '401'), at(60));
    expect(held).toMatchObject([{ k: 'held', since: s(at(0)), n: 3, trip: 'TRIP-1' }]);
    const moved = run(session, busFeed(at(90), 40.751, '402'), at(90));
    expect(moved).toMatchObject([
      { k: 'stn', ev: 'dep', stop: '401', next: '402', lo: s(at(60)), hi: s(at(90)) },
      { k: 'gps', stop: '402', brg: 12 },
    ]);
    // The same report again is not a new one.
    expect(run(session, busFeed(at(90), 40.751, '402'), at(90))).toEqual([]);
  });
});

function alertsFeed(feedTime: string, alerts: { id: string; header: string; start?: string }[]) {
  return {
    feedTime,
    leftOut: 0,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      activePeriods: alert.start === undefined ? [] : [{ start: alert.start, end: null }],
      affected: [{ agencyId: 'MTASBWY', routeId: 'A', stopId: null, tripId: null }],
      cause: null,
      effect: null,
      header: alert.header,
      description: null,
    })),
  };
}

const transitAlerts = recorderExtractors.find((extractor) => extractor.sourceId === 'mta-alerts');

describe('the incident lifecycle', () => {
  it('opens, changes and closes an alert with when it was first and last seen', () => {
    const session = sessionOf(transitAlerts);
    const t1 = '2026-11-11T12:00:00.000Z';
    const t2 = '2026-11-11T12:02:00.000Z';
    const t3 = '2026-11-11T12:04:00.000Z';
    expect(
      run(session, alertsFeed(t1, [{ id: 'lmm:alert:1', header: 'Delays' }]), t1),
    ).toMatchObject([
      { k: 'open', id: 'lmm:alert:1', kind: 'transit-alert', type: 'service-alert', routes: ['A'] },
    ]);
    expect(
      kinds(run(session, alertsFeed(t2, [{ id: 'lmm:alert:1', header: 'More delays' }]), t2, t1)),
    ).toEqual(['change']);
    expect(run(session, alertsFeed(t3, []), t3, t2)).toEqual([
      { k: 'close', t: s(t3), id: 'lmm:alert:1', since: s(t1), last: s(t2) },
    ]);
  });

  it('does not open again what the registry has open, nor planned work not started yet', () => {
    const affected = [{ agencyId: 'MTASBWY', routeId: 'A', stopId: null, tripId: null }];
    const open = new Map([
      ['lmm:alert:1', { fingerprint: fingerprintOf(['Delays', [], affected]), since: 100 }],
    ]);
    const session = sessionOf(transitAlerts, open);
    const t1 = '2026-11-11T12:00:00.000Z';
    const feed = alertsFeed(t1, [
      { id: 'lmm:alert:1', header: 'Delays' },
      { id: 'lmm:planned_work:9', header: 'Weekend work', start: '2026-11-14T05:00:00.000Z' },
    ]);
    expect(run(session, feed, t1)).toEqual([]);
  });

  it('refuses a copy that no longer matches the schema of its source', () => {
    const result = sessionOf(transitAlerts).extract(
      { alerts: 'none' },
      {
        version: 'x',
        dataTime: new Date(),
        previousDataTime: undefined,
      },
    );
    expect(result).toEqual({
      ok: false,
      why: 'The stored copy no longer matches the schema of its source.',
    });
  });
});
