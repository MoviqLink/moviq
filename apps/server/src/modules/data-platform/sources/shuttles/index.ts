import type { SourceDefinition } from '../../definition.js';
import { airportShuttleSources } from './passio-airports.js';
import { passioRouteSource } from './passio-routes.js';
import { passioGoSource } from './passio-go.js';
import { airportShuttleTimetableSource } from './passio-timetable.js';

/** Airport shuttles (GTFS Realtime of Passio) and the shuttles of the Passio GO public map. */
export const shuttleSources: readonly SourceDefinition[] = [
  ...airportShuttleSources,
  airportShuttleTimetableSource,
  passioGoSource,
  passioRouteSource,
];
