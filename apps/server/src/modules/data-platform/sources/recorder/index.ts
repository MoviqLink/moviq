import type { SourceDefinition } from '../../definition.js';
import { recorderStatsSource } from './moviq-recorder-stats.js';

export const recorderSources: readonly SourceDefinition[] = [recorderStatsSource];
