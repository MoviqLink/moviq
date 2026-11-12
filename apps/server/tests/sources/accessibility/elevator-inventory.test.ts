import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mtaElevatorInventory } from '../../../src/modules/data-platform/sources/accessibility/elevator-inventory.js';
import { CAPTURED_AT, accepted, capture, text } from '../mta/captures.js';

function parse(body: Uint8Array) {
  return mtaElevatorInventory.parse(body, { receivedAt: CAPTURED_AT, previous: undefined });
}

function inventory() {
  const result = accepted(parse(capture('elevator-inventory.json')));
  return mtaElevatorInventory.dataSchema.parse(result.data).equipment;
}

const row = {
  equipment_code: 'EL1',
  elevator_or_escalator: 'Elevator',
  ada_compliant: 'YES',
  service_status_code: 'IFIS',
};

describe('MTA subway elevator and escalator inventory', () => {
  it('accepts the capture, dated by its receipt, and names the ADA elevators not in service', () => {
    const result = accepted(parse(capture('elevator-inventory.json')));
    expect(result.dataTime).toEqual(CAPTURED_AT);
    expect(result.coverage).toBe(
      '22 pieces, 18 elevators; ADA elevators not in service: EL229, EL232, EL233, EL331, EL332',
    );
    const stored = mtaElevatorInventory.dataSchema.parse(JSON.parse(JSON.stringify(result.data)));
    expect(stored).toEqual(result.data);
  });

  it('keeps the status and the elevators that stand in at each level', () => {
    expect(inventory()['EL232']).toEqual({
      kind: 'elevator',
      ada: true,
      status: 'RNOS',
      backups: { access: [], street: [], mezzanine: [], platform: [] },
    });
    expect(inventory()['EL331']?.backups).toEqual({
      access: [],
      street: [],
      mezzanine: ['EL332'],
      platform: ['EL330'],
    });
    expect(inventory()['ES105']).toMatchObject({ kind: 'escalator', ada: null, status: 'IFIS' });
  });

  it('reads stand-ins written with commas, slashes, a plus or the EL prefix', () => {
    const written = {
      ...row,
      redundant_elevator_platform: '718X/716',
      redundant_elevator_street: 'EL204, EL296',
      redundant_elevator_access: '17X+',
      redundant_elevator_mezzanine: '11X,13X',
    };
    const data = mtaElevatorInventory.dataSchema.parse(
      accepted(parse(text(JSON.stringify([written])))).data,
    );
    expect(data.equipment['EL1']?.backups).toEqual({
      access: ['EL17X'],
      street: ['EL204', 'EL296'],
      mezzanine: ['EL11X', 'EL13X'],
      platform: ['EL718X', 'EL716'],
    });
  });

  it.each([
    ['not-json', text('<html>503</html>')],
    ['unexpected-shape', text(JSON.stringify([{ ...row, service_status_code: 'in service' }]))],
    ['check-failed', text(JSON.stringify([row, row]))],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses a list cut below the minimum, asking the dataset without a key', () => {
    const rows = z
      .array(z.unknown())
      .parse(JSON.parse(new TextDecoder().decode(capture('elevator-inventory.json'))));
    const data = mtaElevatorInventory.dataSchema.parse(
      accepted(parse(text(JSON.stringify(rows)))).data,
    );
    expect(mtaElevatorInventory.check?.(data, undefined)).toEqual(['18 elevators, minimum 400']);
    const { url } = mtaElevatorInventory.request({ credentials: {}, now: CAPTURED_AT });
    expect(url).toBe(
      'https://data.ny.gov/resource/94fv-bak7.json?$select=equipment_code,elevator_or_escalator,' +
        'ada_compliant,service_status_code,redundant_elevator_access,redundant_elevator_street,' +
        'redundant_elevator_mezzanine,redundant_elevator_platform&$order=equipment_code&$limit=5000',
    );
  });
});
