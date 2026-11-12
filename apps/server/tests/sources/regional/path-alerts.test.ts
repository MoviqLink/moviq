import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  pathAlertsSchema,
  pathAlertsSource,
} from '../../../src/modules/data-platform/sources/regional/path-alerts.js';
import { accepted, capture, captureJson, json, storedAndRead, text } from './captures.js';

const source = pathAlertsSource;
/** Downloaded at 03:56:13 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T03:56:13Z');

function parse(body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

const rows = (): Record<string, unknown>[] =>
  z.array(z.looseObject({})).parse(captureJson('regional', 'path-alerts.json'));

describe('PATH service alerts', () => {
  it('accepts the capture, dated by receipt as the list carries no time of its own', () => {
    const result = accepted(parse(capture('regional', 'path-alerts.json')));
    expect(source.dataTimeSource).toBe('receipt');
    expect(result.dataTime).toEqual(RECEIVED_AT);
    expect(result.coverage).toBe('5 alerts (1 open), 0 left out');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
  });

  it('keeps the kind, the lines named and the time each alert was sent', () => {
    const { alerts } = pathAlertsSchema.parse(
      accepted(parse(capture('regional', 'path-alerts.json'))).data,
    );
    expect(alerts.map((alert) => [alert.kind, alert.state, alert.sentAt])).toEqual([
      ['9 St and 23 St Overnight Advisory', 'closed', '2026-11-11T03:14:37.549Z'],
      ['9 St and 23 St Overnight Advisory', 'closed', '2026-11-11T03:00:00.498Z'],
      ['Mechanical Problem', 'closed', '2026-11-10T22:48:32.558Z'],
      ['Mechanical Problem', 'closed', '2026-11-10T22:22:21.408Z'],
      ['Rail Safety Inspections [TIV] - With Start/End Times', 'open', '2026-11-10T20:10:30.762Z'],
    ]);
    // The update and the final update of one mechanical problem share their incident.
    expect(alerts[2]?.incidentId).toBe(alerts[3]?.incidentId);
    expect(alerts[3]).toMatchObject({
      subject: 'PATHAlert: Mechanical Problem',
      linesNamed: ['NWK-WTC', 'HOB-WTC', 'JSQ-33', 'HOB-33'],
    });
    expect(alerts[3]?.text).toMatch(/^05:22 PM: NWK-WTC delayed\./);
    expect(alerts[0]?.linesNamed).toEqual([]);
    expect(alerts.every((alert) => !alert.text.includes('\n\n'))).toBe(true);
  });

  it('never keeps the name of the person who sent an alert', () => {
    const named = rows().map((row) => ({ ...row, SentBy: 'A. Person' }));
    const result = accepted(parse(json(named)));
    expect(JSON.stringify(result.data)).not.toContain('A. Person');
  });

  it('accepts an empty list: a quiet spell is not a failure', () => {
    expect(accepted(parse(json([]))).coverage).toBe('0 alerts (0 open), 0 left out');
  });

  it('leaves out and counts an alert without a readable send time', () => {
    const [first, ...others] = rows();
    const result = accepted(parse(json([{ ...first, sentdate2: '11/11/2026' }, ...others])));
    expect(result.coverage).toBe('4 alerts (1 open), 1 left out');
  });

  it.each([
    ['not-json', text('<html>Service Unavailable</html>')],
    ['unexpected-shape', json({ status: 'Success', data: [] })],
    ['unexpected-shape', json(rows().map((row) => ({ ...row, state: 'Pending' })))],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });
});
