import { describe, expect, it } from 'vitest';

import type { SourceDefinition } from '../../../src/modules/data-platform/definition.js';
import { mtaElevatorEquipment } from '../../../src/modules/data-platform/sources/accessibility/elevator-equipment.js';
import { mtaElevatorInventory } from '../../../src/modules/data-platform/sources/accessibility/elevator-inventory.js';
import { mtaSubwayStations } from '../../../src/modules/data-platform/sources/accessibility/subway-stations.js';
import { mtaElevators } from '../../../src/modules/data-platform/sources/mta/elevators.js';
import { gtfsStaticSources } from '../../../src/modules/data-platform/sources/mta/gtfs-static.js';
import type { PlanWindow } from '../../../src/modules/journeys/engine/inputs.js';
import {
  stepFreeStops,
  type StepFreeSources,
} from '../../../src/modules/journeys/engine/step-free.js';
import { CAPTURED_AT, capture } from '../../sources/mta/captures.js';

function captured<T>(definition: SourceDefinition<T> | undefined, file: string): T {
  if (definition === undefined) throw new Error('no source');
  const result = definition.parse(capture(file), { receivedAt: CAPTURED_AT, previous: undefined });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.data;
}

const subway = captured(gtfsStaticSources[0], 'gtfs_subway.zip');
const sources: StepFreeSources = {
  stations: captured(mtaSubwayStations, 'subway-stations.json'),
  equipment: captured(mtaElevatorEquipment, 'elevator-equipment.json'),
  inventory: captured(mtaElevatorInventory, 'elevator-inventory.json'),
  outages: captured(mtaElevators, 'elevators.json'),
  // At 1 Av (L06), as in the 2024 entrance survey: two elevators and a stair.
  entrances: {
    readAt: CAPTURED_AT.toISOString(),
    entrances: [
      ['Elevator', 40.7305247, -73.9808688],
      ['Elevator', 40.7306737, -73.9807198],
      ['Stair', 40.7307, -73.9813],
    ].map(([type, lat, lon]) => ({
      stations: ['L06'],
      complex: '119',
      name: '1 Av',
      type: String(type),
      entry: true,
      exit: true,
      point: [Number(lon), Number(lat)] as [number, number],
    })),
  },
};

/** The two hours after the capture (New York, 10/11/2026 from 20:07). */
const TONIGHT: PlanWindow = {
  from: CAPTURED_AT,
  to: new Date(CAPTURED_AT.getTime() + 2 * 3600_000),
};

function newYork(clock: string): Date {
  return new Date(`2026-12-16T${clock}-05:00`);
}

function stepFree(window = TONIGHT, from = sources) {
  return stepFreeStops(subway, from, window);
}

function boarding(ids: readonly string[], result = stepFree()) {
  return ids.map((id) => result.stops[id]);
}

type Equipment = StepFreeSources['equipment']['equipment'][string];
type Backups = StepFreeSources['inventory']['equipment'][string]['backups'];

function withPiece(id: string, change: Partial<Equipment>): StepFreeSources {
  const piece = sources.equipment.equipment[id];
  if (piece === undefined) throw new Error(`${id} is in the capture`);
  const equipment = { ...sources.equipment.equipment, [id]: { ...piece, ...change } };
  return { ...sources, equipment: { ...sources.equipment, equipment } };
}

/** EL760 at Kings Hwy (D35), out tonight, as a redundant elevator with these stand-ins. */
function redundantEl760(backups: Partial<Backups>): StepFreeSources {
  const changed = withPiece('EL760', { redundant: true });
  const piece = sources.inventory.equipment['EL760'];
  if (piece === undefined) throw new Error('EL760 is in the inventory capture');
  const empty = { access: [], street: [], mezzanine: [], platform: [] };
  const inventory = {
    ...sources.inventory.equipment,
    EL760: { ...piece, backups: { ...empty, ...backups } },
  };
  return { ...changed, inventory: { ...sources.inventory, equipment: inventory } };
}

describe('step-free subway stops', () => {
  it('follows the station list on both platforms, or on the one direction it names', () => {
    // 59 St-Columbus Circle is accessible; 49 St only uptown; Van Cortlandt Park-242 St not at all.
    expect(boarding(['125', '125N', '125S'])).toEqual([1, 1, 1]);
    expect(boarding(['R15', 'R15N', 'R15S'])).toEqual([2, 1, 2]);
    expect(boarding(['101', '101N', '101S'])).toEqual([2, 2, 2]);
    expect(stepFree().complexes['127']).toBe(stepFree().complexes['R16']);
  });

  it('keeps the elevators and ramps of the entrance survey, where step-free walks start', () => {
    expect(stepFree().entrances).toEqual({
      L06: [
        { lat: 40.7305247, lon: -73.9808688, entry: true, exit: true },
        { lat: 40.7306737, lon: -73.9807198, entry: true, exit: true },
      ],
    });
  });

  it('closes a station while an elevator of its step-free path is out tonight', () => {
    const result = stepFree();
    // EL760 at Kings Hwy and EL210 at 34 St-Herald Sq are out now.
    expect(result.closed).toEqual(['D17', 'D35', 'R17']);
    expect(boarding(['D35', 'D35N', 'D35S'], result)).toEqual([2, 2, 2]);
    expect(result.unmatched).toEqual([]);
  });

  it('closes a station for an outage announced inside the trip, not before nor after it', () => {
    // EL142 and EL143 at 125 St (A15): announced from 16/12 22:00 to 17/12 06:00.
    expect(boarding(['A15', 'A15S'])).toEqual([1, 1]);
    const during = stepFree({ from: newYork('21:00:00'), to: newYork('23:00:00') });
    expect(during.closed).toEqual(['A07', 'A15', 'D17', 'D35', 'L12', 'R17']);
    expect(boarding(['A15', 'A15S'], during)).toEqual([2, 2]);
    const before = stepFree({ from: newYork('20:00:00'), to: newYork('21:59:59') });
    expect(before.closed).not.toContain('A15');
    const later = stepFree({
      from: new Date('2026-12-17T06:00:00-05:00'),
      to: new Date('2026-12-17T08:00:00-05:00'),
    });
    expect(later.closed).not.toContain('A15');
  });

  it('leaves a station unknown when the inventory has removed an elevator of its path', () => {
    const result = stepFree();
    // EL229, EL232 and EL233 at Times Sq-42 St: "Removed-Non Functioning-Out of Service".
    expect(boarding(['127', '127N', '725', 'A27', 'R16S'], result)).toEqual([2, 2, 2, 2, 2]);
    expect(result.findings.filter((finding) => finding.station === '127')).toEqual(
      ['EL229', 'EL232', 'EL233'].map((equipmentId) => ({
        station: '127',
        state: 'unknown',
        cause: 'not-in-service',
        equipmentId,
      })),
    );
    expect(result.unknown).toEqual(['127', '626', '637', '725', '902', 'A27', 'D21', 'R16']);
  });

  it('leaves a station unknown while the equipment list marks one of its elevators inactive', () => {
    const result = stepFree(TONIGHT, withPiece('EL143', { active: false }));
    expect(result.unknown).toContain('A15');
    expect(result.findings).toContainEqual({
      station: 'A15',
      state: 'unknown',
      cause: 'inactive',
      equipmentId: 'EL143',
    });
  });

  it('keeps a station open only when the stand-ins at every level work', () => {
    // No stand-in listed: the pair is not known, so the outage still closes Kings Hwy.
    expect(stepFree(TONIGHT, redundantEl760({})).closed).toContain('D35');
    expect(stepFree(TONIGHT, redundantEl760({ platform: ['EL143'] })).closed).not.toContain('D35');
    // EL210 is out too, EL999 is on no list, and a level without a stand-in that works.
    expect(stepFree(TONIGHT, redundantEl760({ platform: ['EL210'] })).closed).toContain('D35');
    expect(stepFree(TONIGHT, redundantEl760({ platform: ['EL999'] })).closed).toContain('D35');
    const levels = redundantEl760({ street: ['EL143'], platform: ['EL210', 'EL142'] });
    expect(stepFree(TONIGHT, levels).closed).not.toContain('D35');
    const brokenLevel = redundantEl760({ street: ['EL143'], platform: ['EL210'] });
    expect(stepFree(TONIGHT, brokenLevel).closed).toContain('D35');
  });

  it('leaves Bleecker St unknown: two removed elevators stand in for each other', () => {
    const result = stepFree();
    expect(result.findings.filter((finding) => finding.station === '637')).toEqual(
      ['EL331', 'EL332'].map((equipmentId) => ({
        station: '637',
        state: 'unknown',
        cause: 'not-in-service',
        equipmentId,
      })),
    );
  });

  it('leaves a station unknown for an accessibility note it cannot read', () => {
    // 86 St (626): "Uptown local only", so the 4 and 5 uptown are not step-free.
    expect(sources.stations.stations['626']).toMatchObject({ ada: 'partial', northbound: true });
    expect(boarding(['626', '626N', '626S'])).toEqual([2, 2, 2]);
    expect(stepFree().findings).toContainEqual({
      station: '626',
      state: 'unknown',
      cause: 'note',
      equipmentId: null,
    });
  });

  it('names the elevators it cannot place: off the equipment list, or on no known station', () => {
    const [first] = sources.outages.outages;
    if (first === undefined) throw new Error('the capture has outages');
    const outage = { ...first, equipmentId: 'EL999', kind: 'elevator' as const, ada: true };
    const unlisted = {
      ...sources,
      outages: { ...sources.outages, outages: [...sources.outages.outages, outage] },
    };
    expect(stepFree(TONIGHT, unlisted).unmatched).toEqual(['EL999']);
    expect(stepFree(TONIGHT, withPiece('EL760', { stations: [] })).unmatched).toEqual(['EL760']);
    expect(stepFree(TONIGHT, withPiece('EL760', { stations: ['Z99'] })).unmatched).toEqual([
      'EL760',
    ]);
    const removed = withPiece('EL232', { stations: [] });
    expect(stepFree(TONIGHT, removed).unmatched).toEqual(['EL232']);
  });
});
