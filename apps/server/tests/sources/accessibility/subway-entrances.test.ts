import { describe, expect, it } from 'vitest';

import { mtaSubwayStations } from '../../../src/modules/data-platform/sources/accessibility/subway-stations.js';
import { mtaSubwayEntrances } from '../../../src/modules/data-platform/sources/accessibility/subway-entrances.js';
import { CAPTURED_AT, capture as mtaCapture } from '../mta/captures.js';
import { accepted, capture, text } from '../ny511/captures.js';

const at = { receivedAt: new Date('2026-11-11T04:31:26Z'), previous: undefined };

function entrances() {
  return accepted(mtaSubwayEntrances.parse(capture('accessibility', 'subway-entrances.json'), at))
    .data.entrances;
}

describe('MTA subway entrances and exits', () => {
  it('accepts the whole capture, dated by its receipt, and stores it unchanged', () => {
    const result = accepted(
      mtaSubwayEntrances.parse(capture('accessibility', 'subway-entrances.json'), at),
    );
    expect(result.dataTime).toEqual(at.receivedAt);
    expect(result.coverage).toBe('2,120 entrances, 102 elevators');
    expect(mtaSubwayEntrances.dataSchema.parse(JSON.parse(JSON.stringify(result.data)))).toEqual(
      result.data,
    );
    expect(mtaSubwayEntrances.check?.(result.data, undefined)).toEqual([]);
  });

  it('joins every entrance to stations of the subway timetable', () => {
    const stations = mtaSubwayStations.parse(mtaCapture('subway-stations.json'), {
      receivedAt: CAPTURED_AT,
      previous: undefined,
    });
    if (!stations.ok) throw new Error('stations capture refused');
    const known = new Set(Object.keys(stations.data.stations));
    const ids = entrances().flatMap((entrance) => entrance.stations);
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
    expect(entrances().filter((entrance) => entrance.stations.length === 2)).toHaveLength(14);
  });

  it('keeps the type and the way through of each entrance, as surveyed in 2024', () => {
    const all = entrances();
    expect(all.filter((entrance) => entrance.entry && !entrance.exit)).toHaveLength(7);
    expect(all.filter((entrance) => !entrance.entry && entrance.exit)).toHaveLength(48);
    expect(
      all.find((entrance) => entrance.type === 'Elevator' && entrance.stations.includes('R31')),
    ).toMatchObject({
      complex: '617',
      name: 'Atlantic Av-Barclays Ctr',
      entry: true,
      exit: true,
    });
  });

  it.each([
    ['not-json', text('<html></html>')],
    ['unexpected-shape', text(JSON.stringify([{ station_id: '1', gtfs_stop_id: 'R3' }]))],
  ])('refuses %s', (code, body) => {
    expect(mtaSubwayEntrances.parse(body, at)).toMatchObject({ ok: false, code });
  });
});
