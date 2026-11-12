import type { SourceDefinition } from '../../definition.js';
import { ferryAlertSources } from './ferry-alerts.js';
import { nyWaterwayRealtimeSources } from './ny-waterway.js';
import { nycFerryRealtimeSources } from './nyc-ferry-realtime.js';
import { ferryTimetableSources } from './timetables.js';

/**
 * NYC Ferry (timetable, boat positions, predictions and alerts), NY Waterway (timetable, boat
 * positions and alerts) and the Staten Island Ferry timetable.
 */
export const ferrySources: readonly SourceDefinition[] = [
  ...ferryTimetableSources,
  ...nycFerryRealtimeSources,
  ...nyWaterwayRealtimeSources,
  ...ferryAlertSources,
];
