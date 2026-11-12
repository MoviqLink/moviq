import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mtaElevatorEquipment } from '../../../src/modules/data-platform/sources/accessibility/elevator-equipment.js';
import { CAPTURED_AT, accepted, capture, text } from '../mta/captures.js';

function parse(body: Uint8Array) {
  return mtaElevatorEquipment.parse(body, { receivedAt: CAPTURED_AT, previous: undefined });
}

function equipment() {
  const result = accepted(parse(capture('elevator-equipment.json')));
  return mtaElevatorEquipment.dataSchema.parse(result.data).equipment;
}

describe('MTA subway elevators and escalators', () => {
  it('accepts the capture, dated by its receipt, and stores it unchanged', () => {
    const result = accepted(parse(capture('elevator-equipment.json')));
    expect(result.dataTime).toEqual(CAPTURED_AT);
    expect(result.coverage).toBe('22 pieces, 18 elevators');
    const stored = mtaElevatorEquipment.dataSchema.parse(JSON.parse(JSON.stringify(result.data)));
    expect(stored).toEqual(result.data);
  });

  it('names the GTFS stations each piece serves', () => {
    expect(equipment()['EL210']).toEqual({
      kind: 'elevator',
      ada: true,
      active: true,
      redundant: false,
      stations: ['D17', 'R17'],
    });
    expect(equipment()['ES366X']?.stations).toEqual(['229', '418', 'A38', 'M22']);
  });

  it('names the ADA elevators the list marks inactive', () => {
    const rows = z
      .array(z.record(z.string(), z.unknown()))
      .parse(JSON.parse(new TextDecoder().decode(capture('elevator-equipment.json'))));
    const inactive = rows.map((row) =>
      row['equipmentno'] === 'EL143' ? { ...row, isactive: 'N' } : row,
    );
    expect(accepted(parse(text(JSON.stringify(inactive)))).coverage).toBe(
      '22 pieces, 18 elevators; ADA elevators marked inactive: EL143',
    );
  });

  it.each([
    ['not-json', text('{"error":')],
    ['unexpected-shape', text(JSON.stringify([{ equipmentno: 'EL1', equipmenttype: 'XX' }]))],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses a piece listed twice and a list cut below the minimum', () => {
    const rows = z
      .array(z.unknown())
      .parse(JSON.parse(new TextDecoder().decode(capture('elevator-equipment.json'))));
    expect(parse(text(JSON.stringify([...rows, rows[0]])))).toMatchObject({ code: 'check-failed' });
    const data = mtaElevatorEquipment.dataSchema.parse(
      accepted(parse(capture('elevator-equipment.json'))).data,
    );
    expect(mtaElevatorEquipment.check?.(data, undefined)).toEqual(['18 elevators, minimum 350']);
  });
});
