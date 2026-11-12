import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { nycPermittedEventsToday } from '../../../src/modules/data-platform/sources/street/permitted-events.js';
import { nycStreetClosuresToday } from '../../../src/modules/data-platform/sources/street/street-closures.js';
import { nycStreetPermitSources } from '../../../src/modules/data-platform/sources/street/street-permits.js';
import { accepted, capture, captureJson, text } from '../ny511/captures.js';

/**
 * The captures were taken at 04:31-04:35 UTC on 11/11/2026 (23:31 on 10/11 in New York) asking
 * for 11/11; they are read as at 00:30 in New York on 11/11, when the sources ask that day.
 */
const FOR_THE_DAY = new Date('2026-11-11T05:30:00Z');

describe('NYC street closures for construction today', () => {
  const parse = (
    body = capture('street', 'street-closures-today.json'),
    receivedAt = FOR_THE_DAY,
  ) => nycStreetClosuresToday.parse(body, { receivedAt, previous: undefined });

  it('lists each closed block once, with its days and its line', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('7 blocks closed on 2026-11-11, 0 left out');
    expect(result.data.closures[0]).toMatchObject({
      borough: 'Bronx',
      firstDay: '2026-11-06',
      lastDay: '2026-11-17',
      geometry: { type: 'MultiLineString' },
    });
    expect(
      nycStreetClosuresToday.dataSchema.parse(JSON.parse(JSON.stringify(result.data))),
    ).toEqual(result.data);
    expect(nycStreetClosuresToday.check?.(result.data, undefined)).toEqual([
      '7 blocks, minimum 300',
    ]);
  });

  it('asks the New York day of the request, not the UTC one', () => {
    const { url } = nycStreetClosuresToday.request({
      credentials: {},
      now: new Date('2026-11-11T04:31:25Z'),
    });
    expect(decodeURIComponent(url)).toContain(
      "work_start_date<='2026-11-10T23:59:59' AND work_end_date>='2026-11-10T00:00:00'",
    );
  });

  it('keeps out a block whose days do not cover the day, and refuses one id with two blocks', () => {
    const later = accepted(
      parse(capture('street', 'street-closures-today.json'), new Date('2026-11-18T05:30:00Z')),
    );
    expect(later.data.closures.every((closure) => closure.lastDay >= '2026-11-18')).toBe(true);
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .parse(captureJson('street', 'street-closures-today.json'));
    const clash = [...rows, { ...rows[0], purpose: 'OTHER' }];
    expect(parse(text(JSON.stringify(clash)))).toMatchObject({ ok: false, code: 'check-failed' });
  });
});

describe('NYC permitted events today', () => {
  const parse = (body = capture('street', 'permitted-events-today.json')) =>
    nycPermittedEventsToday.parse(body, { receivedAt: FOR_THE_DAY, previous: undefined });
  const rows = () =>
    z
      .array(z.record(z.string(), z.unknown()))
      .parse(captureJson('street', 'permitted-events-today.json'));
  const market = (start: string, end: string, name = 'Mount Sinai Greenmarket Wednesday') => ({
    ...rows()[2],
    event_name: name,
    start_date_time: start,
    end_date_time: end,
  });

  it('keeps each permit with its closure, its New York times read as instants', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe(
      '8 events on 2026-11-11, 7 with a closure, 1 in force since an earlier day',
    );
    expect(result.data.events.find((event) => event.id === '899286')).toEqual({
      id: '899286',
      name: 'VETERANS DAY FESTIVAL',
      type: 'Street Festival',
      agency: 'Street Activity Permit Office',
      borough: 'Manhattan',
      location: 'BROADWAY between LIBERTY STREET and BATTERY PLACE',
      side: 'Full',
      closure: 'Full Street Closure',
      startsAt: '2026-11-11T15:00:00.000Z',
      endsAt: '2026-11-11T23:00:00.000Z',
      stretches: [{ startsAt: '2026-11-11T15:00:00.000Z', endsAt: '2026-11-11T23:00:00.000Z' }],
    });
    expect(result.data.events.find((event) => event.id === '796129')?.closure).toBeNull();
    expect(
      nycPermittedEventsToday.dataSchema.parse(JSON.parse(JSON.stringify(result.data))),
    ).toEqual(result.data);
  });

  it('keeps a long permit in force today with its own stretch, so it says until when it holds', () => {
    const closure = accepted(parse()).data.events.find((event) => event.id === '796129');
    // The Parks closure of a basketball court: 08:00 on 30/06/2024 to 23:00 on 31/12/2026.
    expect(closure).toMatchObject({
      name: 'Closure',
      startsAt: '2024-06-30T12:00:00.000Z',
      endsAt: '2027-01-01T04:00:00.000Z',
    });
  });

  it('leaves out a stretch that only touches the day, from midnight to midnight in New York', () => {
    const body = [
      market('2026-11-10T20:00:00.000', '2026-11-11T00:00:00.000'),
      { ...market('2026-11-12T00:00:00.000', '2026-11-12T06:00:00.000'), event_id: '1' },
      { ...market('2026-11-04T08:00:00.000', '2026-11-04T17:00:00.000'), event_id: '2' },
      { ...market('2026-11-11T23:59:00.000', '2026-11-12T01:00:00.000'), event_id: '3' },
    ];
    const events = accepted(parse(text(JSON.stringify(body)))).data.events;
    expect(events.map((event) => event.id)).toEqual(['3']);
  });

  it('joins the stretches of one event in force today, and refuses one id for two permits', () => {
    const body = [
      market('2026-11-11T20:00:00.000', '2026-11-12T02:00:00.000'),
      market('2026-11-10T20:00:00.000', '2026-11-11T02:00:00.000'),
    ];
    const [event, ...others] = accepted(parse(text(JSON.stringify(body)))).data.events;
    expect(others).toEqual([]);
    expect(event).toMatchObject({
      startsAt: '2026-11-11T01:00:00.000Z',
      endsAt: '2026-11-12T07:00:00.000Z',
      stretches: [
        { startsAt: '2026-11-11T01:00:00.000Z', endsAt: '2026-11-11T07:00:00.000Z' },
        { startsAt: '2026-11-12T01:00:00.000Z', endsAt: '2026-11-12T07:00:00.000Z' },
      ],
    });
    const clash = [body[0], market('2026-11-11T08:00:00.000', '2026-11-11T09:00:00.000', 'Other')];
    expect(parse(text(JSON.stringify(clash)))).toMatchObject({
      ok: false,
      code: 'check-failed',
      detail: 'event 911512 twice, with other data',
    });
  });
});

describe('NYC street construction permits in force', () => {
  const statenIsland = nycStreetPermitSources[4];
  if (statenIsland === undefined) throw new Error('no Staten Island source');
  const parse = () =>
    statenIsland.parse(capture('street', 'street-permits-staten-island.json'), {
      receivedAt: FOR_THE_DAY,
      previous: undefined,
    });

  it('reads the work window in New York time, on both sides of the change to winter time', () => {
    const result = accepted(parse());
    expect(result.coverage).toBe('6 permits in force on 2026-11-11, 0 left out');
    expect(result.data.permits[0]).toMatchObject({
      number: 'S012026217A20',
      status: 'ISSUED & PRINTED',
      workFrom: '2026-08-15T04:00:00.000Z',
      workTo: '2026-11-13T04:59:59.000Z',
    });
    expect(statenIsland.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(statenIsland.check?.(result.data, undefined)).toEqual(['6 permits, minimum 1000']);
  });

  it('asks one borough, the statuses in force and the permits of the day', () => {
    const { url } = statenIsland.request({ credentials: {}, now: FOR_THE_DAY });
    const where = decodeURIComponent(url);
    expect(where).toContain("boroughname='STATEN ISLAND'");
    expect(where).toContain(
      "permitstatusshortdesc in('ISSUED & PRINTED','CONFIRMATION REC''D','EMERGENCY')",
    );
    expect(where).toContain("issuedworkstartdate<='2026-11-11T23:59:59'");
    expect(nycStreetPermitSources.map((source) => source.id)).toEqual([
      'nyc-street-permits-manhattan',
      'nyc-street-permits-brooklyn',
      'nyc-street-permits-queens',
      'nyc-street-permits-bronx',
      'nyc-street-permits-staten-island',
    ]);
  });

  it('is a permit, never a closure: it feeds the map, not the watch of a trip', () => {
    for (const source of nycStreetPermitSources) expect(source.consumers).toEqual(['live-map']);
    expect(nycStreetClosuresToday.consumers).toContain('trip-watch');
  });
});
