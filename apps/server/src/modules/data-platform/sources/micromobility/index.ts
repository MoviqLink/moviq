import type { SourceDefinition } from '../../definition.js';
import { fleetSources } from './operators.js';

/** Shared scooters and e-bikes parked in the street: Lime, Veo (Bronx and Queens) and Bird. */
export const micromobilitySources: readonly SourceDefinition[] = [...fleetSources];
