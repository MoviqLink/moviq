import type { ElevatorEquipment } from '../../data-platform/sources/accessibility/elevator-equipment.js';
import {
  IN_SERVICE,
  type ElevatorInventory,
} from '../../data-platform/sources/accessibility/elevator-inventory.js';
import type { ElevatorOutages } from '../../data-platform/sources/mta/elevators.js';
import type { PlanWindow } from './inputs.js';

/** Why an elevator does not serve its path: an outage, or the lists say it is not working. */
export type ElevatorCause = 'outage' | 'not-in-service' | 'inactive';

interface ElevatorLists {
  readonly equipment: ElevatorEquipment;
  readonly inventory: ElevatorInventory;
  readonly outages: ElevatorOutages;
}

/** A step-free elevator whose path is broken, and the stations it serves. */
interface BrokenPath {
  readonly equipmentId: string;
  readonly cause: ElevatorCause;
  readonly stations: readonly string[];
}

type Outage = ElevatorOutages['outages'][number];

/**
 * An outage counts when it may overlap the trip: one in force now always (an estimated return
 * already past does not mean the elevator is back), one announced when it starts by the arrival
 * and is not over, by its estimated return, before the trip can leave.
 */
function overlaps(outage: Outage, window: PlanWindow): boolean {
  if (!outage.upcoming) return true;
  if (Date.parse(outage.since) > window.to.getTime()) return false;
  return (
    outage.estimatedReturn === null || Date.parse(outage.estimatedReturn) > window.from.getTime()
  );
}

function outagesDuring(outages: ElevatorOutages, window: PlanWindow): Set<string> {
  const out = new Set<string>();
  for (const outage of outages.outages) {
    if (outage.kind === 'elevator' && overlaps(outage, window)) out.add(outage.equipmentId);
  }
  return out;
}

/** Why an elevator of the equipment list is not working during the window, if it is not. */
function causeOf(
  id: string,
  lists: ElevatorLists,
  out: ReadonlySet<string>,
): ElevatorCause | undefined {
  if (out.has(id)) return 'outage';
  if (lists.equipment.equipment[id]?.active === false) return 'inactive';
  const status = lists.inventory.equipment[id]?.status;
  return status !== undefined && status !== IN_SERVICE ? 'not-in-service' : undefined;
}

/**
 * Whether the elevators that stand in for one cover its path: at every level the inventory lists,
 * one of them works and the outages feed follows it. With none listed the pair is not known.
 */
function covered(id: string, lists: ElevatorLists, out: ReadonlySet<string>): boolean {
  const backups = lists.inventory.equipment[id]?.backups;
  const levels =
    backups === undefined ? [] : Object.values(backups).filter((codes) => codes.length > 0);
  if (levels.length === 0) return false;
  const works = (code: string): boolean =>
    lists.equipment.equipment[code]?.kind === 'elevator' && causeOf(code, lists, out) === undefined;
  return levels.every((codes) => codes.some(works));
}

/**
 * The step-free elevators whose path is broken during the window, and those that cannot be
 * placed: an outage of an elevator the equipment list does not name, or a broken path whose
 * stations are missing from the list or the station list.
 */
export function brokenPaths(
  lists: ElevatorLists,
  window: PlanWindow,
  knownStation: (id: string) => boolean,
): { readonly broken: readonly BrokenPath[]; readonly unmatched: readonly string[] } {
  const out = outagesDuring(lists.outages, window);
  const unmatched = new Set<string>();
  for (const outage of lists.outages.outages) {
    const named = lists.equipment.equipment[outage.equipmentId] !== undefined;
    if (!named && outage.ada && out.has(outage.equipmentId)) unmatched.add(outage.equipmentId);
  }
  const broken: BrokenPath[] = [];
  for (const id of Object.keys(lists.equipment.equipment).sort()) {
    const piece = lists.equipment.equipment[id];
    if (piece?.kind !== 'elevator' || !piece.ada) continue;
    const cause = causeOf(id, lists, out);
    if (cause === undefined || (piece.redundant && covered(id, lists, out))) continue;
    if (piece.stations.length === 0 || !piece.stations.every(knownStation)) unmatched.add(id);
    else broken.push({ equipmentId: id, cause, stations: piece.stations });
  }
  return { broken, unmatched: [...unmatched].sort() };
}
