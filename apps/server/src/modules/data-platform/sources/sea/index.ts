import type { SourceDefinition } from '../../definition.js';
import { openWatersSource } from './open-waters.js';

/** Vessels in New York Harbor by AIS. */
export const seaSources: readonly SourceDefinition[] = [openWatersSource];
