import type { SourceDefinition } from '../../definition.js';
import { beeLineSources } from './bee-line.js';

/** The Bee-Line timetable and its buses in real time. */
export const westchesterSources: readonly SourceDefinition[] = [...beeLineSources];
