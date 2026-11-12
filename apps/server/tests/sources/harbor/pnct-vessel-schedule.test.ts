import { describe, expect, it } from 'vitest';

import {
  pnctScheduleSchema,
  pnctVesselSchedule,
} from '../../../src/modules/data-platform/sources/harbor/pnct-vessel-schedule.js';
import { accepted, capture, storedAndRead, text } from '../regional/captures.js';

const source = pnctVesselSchedule;
/** Downloaded at 04:02:24 UTC on 11/11/2026 (23:02 on 10/11 in New York). */
const RECEIVED_AT = new Date('2026-11-11T04:02:24Z');

function parse(body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

const row = {
  VisitReference: 'TEST-001A-001A',
  VesselName: 'TEST VESSEL',
  VesselCode: 'TEST',
  LineOperator: null,
  IbVoyNumber: '001A',
  ObVoyNumber: '001A',
  EstimatedArrival: '2026-07-01T06:00:00',
  Arrival: null,
  EstimatedDeparture: '2026-07-01T23:00:00',
  Departure: null,
};

/** A page with the schedule block, its list escaped as the terminal's page escapes it. */
function page(list: unknown): Uint8Array {
  const escaped = JSON.stringify(list).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return text(
    `<html><body><div id="divVslSchedules" ng-cloak data-ds="${escaped}"></div></body></html>`,
  );
}

function calls(body: Uint8Array) {
  return pnctScheduleSchema.parse(accepted(parse(body)).data).calls;
}

describe('PNCT vessel schedule', () => {
  it('accepts the page of the tests, dated by receipt as the page carries no time of its own', () => {
    const result = accepted(parse(capture('harbor', 'pnct-vessel-schedule.txt')));
    expect(source.dataTimeSource).toBe('receipt');
    expect(result.dataTime).toEqual(RECEIVED_AT);
    expect(result.coverage).toBe('35 vessel calls, 2 at berth, 7 gone');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
  });

  it('keeps the expected and the actual times, read as New York time', () => {
    const byVessel = new Map(
      calls(capture('harbor', 'pnct-vessel-schedule.txt')).map((call) => [call.vessel, call]),
    );
    expect(byVessel.get('TEST VESSEL 11')).toEqual({
      visit: 'TV11-011A-011B',
      vessel: 'TEST VESSEL 11',
      vesselCode: 'TV11',
      line: null,
      inboundVoyage: '011A',
      outboundVoyage: '011B',
      expectedArrival: '2026-11-11T11:00:00.000Z',
      arrived: '2026-11-11T03:24:00.000Z',
      expectedDeparture: '2026-11-12T02:00:00.000Z',
      departed: null,
      stage: 'at-berth',
    });
    expect(byVessel.get('TEST VESSEL 02')).toMatchObject({
      departed: '2026-11-06T19:42:00.000Z',
      stage: 'departed',
    });
    // No actual time yet: announced, however old the expected arrival.
    expect(byVessel.get('TEST VESSEL 01')).toMatchObject({ arrived: null, stage: 'announced' });
  });

  it('follows daylight saving time: a July call is four hours behind UTC', () => {
    expect(calls(page([row]))[0]?.expectedArrival).toBe('2026-07-01T10:00:00.000Z');
  });

  it('leaves out and counts a call with a time that does not exist', () => {
    const result = accepted(
      parse(page([row, { ...row, EstimatedArrival: '2026-11-31T06:00:00' }])),
    );
    expect(pnctScheduleSchema.parse(result.data).leftOut).toBe(1);
  });

  it.each([
    ['not-text', Uint8Array.from([0xff, 0xfe, 0xfd])],
    ['no-schedule', text('<html><body>Checking your browser…</body></html>')],
    ['unexpected-shape', page([{ ...row, VesselName: undefined }])],
    ['empty-schedule', page([])],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });
});
