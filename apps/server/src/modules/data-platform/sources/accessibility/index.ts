import type { SourceDefinition } from '../../definition.js';
import { mtaElevatorEquipment } from './elevator-equipment.js';
import { mtaElevatorInventory } from './elevator-inventory.js';
import { mtaSubwayEntrances } from './subway-entrances.js';
import { mtaSubwayStations } from './subway-stations.js';

/**
 * Step-free access to the subway: which stations are accessible, which elevators serve them and
 * whether the inventory has them in service.
 */
export const accessibilitySources: readonly SourceDefinition[] = [
  mtaSubwayStations,
  mtaElevatorEquipment,
  mtaElevatorInventory,
  mtaSubwayEntrances,
];
