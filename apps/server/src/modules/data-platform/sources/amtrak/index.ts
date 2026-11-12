import type { SourceDefinition } from '../../definition.js';
import { amtrakerSource } from './amtraker.js';

/** Amtrak trains around New York, from Amtraker. */
export const amtrakSources: readonly SourceDefinition[] = [amtrakerSource];
