import type { SourceDefinition } from '../../definition.js';
import { coastGuardNotices } from './coast-guard-notices.js';
import { portsSources } from './noaa-ports.js';
import { pnctVesselSchedule } from './pnct-vessel-schedule.js';

/**
 * New York Harbor: Coast Guard notices to mariners, the Port Newark Container Terminal vessel
 * schedule and four NOAA PORTS measures (water level, air gap, current and wind).
 */
export const harborSources: readonly SourceDefinition[] = [
  coastGuardNotices,
  pnctVesselSchedule,
  ...portsSources,
];
