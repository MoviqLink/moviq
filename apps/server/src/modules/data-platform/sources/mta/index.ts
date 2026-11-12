import type { SourceDefinition } from '../../definition.js';
import { mtaAlerts } from './alerts.js';
import { busSources } from './bus-realtime.js';
import { mtaElevators } from './elevators.js';
import { gtfsStaticSources } from './gtfs-static.js';
import { subwaySources } from './subway-realtime.js';

/** Every MTA source: 7 timetables, 8 subway feeds, 2 Bus Time feeds, alerts and elevators. */
export const mtaSources: readonly SourceDefinition[] = [
  ...gtfsStaticSources,
  ...subwaySources,
  ...busSources,
  mtaAlerts,
  mtaElevators,
];
