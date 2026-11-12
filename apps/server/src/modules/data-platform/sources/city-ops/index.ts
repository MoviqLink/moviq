import type { SourceDefinition } from '../../definition.js';
import { plowNycSource } from './plownyc.js';

/** City operations that affect the street: PlowNYC snow vehicle tracking. */
export const cityOpsSources: readonly SourceDefinition[] = [plowNycSource];
