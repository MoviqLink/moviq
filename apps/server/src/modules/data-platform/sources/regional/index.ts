import type { SourceDefinition } from '../../definition.js';
import { pathAlertsSource } from './path-alerts.js';
import { pathArrivalsSource } from './path-arrivals.js';
import { railRealtimeSources } from './rail-realtime.js';
import { railTimetableSources } from './rail-timetables.js';

/** LIRR and Metro-North (timetables and live trains), PATH arrivals and PATH alerts. */
export const regionalSources: readonly SourceDefinition[] = [
  ...railTimetableSources,
  ...railRealtimeSources,
  pathArrivalsSource,
  pathAlertsSource,
];
