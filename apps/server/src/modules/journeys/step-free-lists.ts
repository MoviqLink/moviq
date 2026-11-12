import type { Provenance } from '@moviq/contracts';

import type { SourceDefinition } from '../data-platform/definition.js';
import type { SourceReader } from '../data-platform/reader.js';
import { mtaElevatorEquipment } from '../data-platform/sources/accessibility/elevator-equipment.js';
import { mtaElevatorInventory } from '../data-platform/sources/accessibility/elevator-inventory.js';
import { mtaSubwayEntrances } from '../data-platform/sources/accessibility/subway-entrances.js';
import { mtaSubwayStations } from '../data-platform/sources/accessibility/subway-stations.js';
import { mtaElevators } from '../data-platform/sources/mta/elevators.js';
import { trusted } from './engine/platform-sources.js';
import type { StepFreeSources } from './engine/step-free.js';

/** Each list of a step-free check with its provenance, for the age and the proof of what it says. */
type StepFreeProvenance = Readonly<Record<keyof StepFreeSources, Provenance>>;

/**
 * The five MTA lists of a step-free check, as the routing engine uses them: all of them
 * `healthy` or `degraded`, or the ones that are not, so the check is never taken as passed.
 */
export type StepFreeReading =
  | {
      readonly ok: true;
      readonly lists: StepFreeSources;
      readonly provenance: StepFreeProvenance;
    }
  | {
      readonly ok: false;
      /** The lists that cannot be used, in the order of `STEP_FREE_SOURCES`. */
      readonly down: readonly Provenance[];
      readonly provenance: StepFreeProvenance;
    };

/** The sources of the check, so the watch keeps them fast while journeys need them. */
export const STEP_FREE_SOURCES: readonly SourceDefinition[] = [
  mtaElevators,
  mtaSubwayStations,
  mtaElevatorEquipment,
  mtaElevatorInventory,
  mtaSubwayEntrances,
];

/** What each list is, in the sentences of the watch. */
export const STEP_FREE_LIST_NAMES: Readonly<Record<string, string>> = {
  [mtaElevators.id]: 'elevator outages',
  [mtaSubwayStations.id]: 'list of accessible stations',
  [mtaElevatorEquipment.id]: 'elevator list',
  [mtaElevatorInventory.id]: 'elevator inventory',
  [mtaSubwayEntrances.id]: 'entrance survey',
};

/** Reads the five lists once, through the platform reader of the process. */
export async function readStepFreeLists(reader: SourceReader): Promise<StepFreeReading> {
  const [outages, stations, equipment, inventory, entrances] = await Promise.all([
    reader.read(mtaElevators),
    reader.read(mtaSubwayStations),
    reader.read(mtaElevatorEquipment),
    reader.read(mtaElevatorInventory),
    reader.read(mtaSubwayEntrances),
  ]);
  const provenance: StepFreeProvenance = {
    outages: outages.provenance,
    stations: stations.provenance,
    equipment: equipment.provenance,
    inventory: inventory.provenance,
    entrances: entrances.provenance,
  };
  const lists = {
    outages: trusted(outages),
    stations: trusted(stations),
    equipment: trusted(equipment),
    inventory: trusted(inventory),
    entrances: trusted(entrances),
  };
  if (
    lists.outages === undefined ||
    lists.stations === undefined ||
    lists.equipment === undefined ||
    lists.inventory === undefined ||
    lists.entrances === undefined
  ) {
    const usable = [
      lists.outages,
      lists.stations,
      lists.equipment,
      lists.inventory,
      lists.entrances,
    ];
    const down = [outages, stations, equipment, inventory, entrances]
      .filter((_, at) => usable[at] === undefined)
      .map((reading) => reading.provenance);
    return { ok: false, down, provenance };
  }
  return {
    ok: true,
    lists: {
      outages: lists.outages,
      stations: lists.stations,
      equipment: lists.equipment,
      inventory: lists.inventory,
      entrances: lists.entrances,
    },
    provenance,
  };
}
