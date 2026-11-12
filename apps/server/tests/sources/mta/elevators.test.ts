import { describe, expect, it } from 'vitest';

import { elevatorOutagesSchema } from '../../../src/modules/data-platform/sources/mta/elevators.js';
import {
  CAPTURED_AT,
  accepted,
  capture,
  parseFresh,
  source,
  storedAndRead,
  text,
} from './captures.js';

const row = {
  station: '175 St',
  borough: '',
  trainno: 'A/C',
  equipment: 'EL124',
  equipmenttype: 'EL',
  serving: 'Mezzanine to platform for service in both directions.',
  ADA: 'Y',
  outagedate: '11/10/2026 06:37:00 PM',
  estimatedreturntoservice: '07/01/2026 10:00:00 AM',
  reason: 'Repair',
  isupcomingoutage: 'N',
  ismaintenanceoutage: 'N',
};

function json(value: unknown): Uint8Array {
  return text(JSON.stringify(value));
}

describe('MTA elevator and escalator outages', () => {
  it('accepts the capture, dated when it was read because the feed has no time', () => {
    const result = accepted(parseFresh('mta-elevators', capture('elevators.json')));
    expect(result.dataTime).toEqual(CAPTURED_AT);
    expect(source('mta-elevators').dataTimeSource).toBe('receipt');
    expect(result.coverage).toBe('6 out of service now (2 elevators, 4 escalators), 10 announced');
    expect(storedAndRead('mta-elevators', result.data)).toEqual(result.data);
  });

  it('reads New York wall-clock times on both sides of daylight saving', () => {
    const { outages } = elevatorOutagesSchema.parse(
      accepted(parseFresh('mta-elevators', json([row]))).data,
    );
    expect(outages[0]).toMatchObject({
      equipmentId: 'EL124',
      kind: 'elevator',
      station: '175 St',
      lines: ['A', 'C'],
      ada: true,
      reason: 'Repair',
      since: '2026-11-10T23:37:00.000Z',
      estimatedReturn: '2026-07-01T14:00:00.000Z',
      upcoming: false,
    });
  });

  it('keeps an outage without a return date as having none', () => {
    const { outages } = elevatorOutagesSchema.parse(
      accepted(parseFresh('mta-elevators', json([{ ...row, estimatedreturntoservice: '' }]))).data,
    );
    expect(outages[0]?.estimatedReturn).toBeNull();
  });

  it.each([
    ['not-json', text('<html>503 Service Unavailable</html>')],
    ['unexpected-shape', json({ outages: [row] })],
    ['unexpected-shape', json([{ ...row, equipmenttype: 'XX' }])],
    ['bad-date', json([{ ...row, outagedate: '2026-11-10 18:37' }])],
    ['empty-feed', json([])],
  ])('refuses %s', (code, body) => {
    expect(parseFresh('mta-elevators', body)).toMatchObject({ ok: false, code });
  });
});
