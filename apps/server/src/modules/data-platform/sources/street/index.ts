import type { SourceDefinition } from '../../definition.js';
import { afdcNewJerseyChargers } from './afdc-chargers.js';
import { nycDefibrillators } from './defibrillators.js';
import { nycEvChargers } from './ev-chargers.js';
import { nycLandmarks } from './landmarks.js';
import { nycParkingMeters } from './parking-meters.js';
import { nycPermittedEventsToday } from './permitted-events.js';
import { nycPublicRestrooms } from './public-restrooms.js';
import { nycStreetClosuresToday } from './street-closures.js';
import { nycStreetPermitSources } from './street-permits.js';

/**
 * The street: closures, events and permits of today, meters, chargers, defibrillators and public
 * restrooms.
 */
export const streetSources: readonly SourceDefinition[] = [
  nycStreetClosuresToday,
  nycPermittedEventsToday,
  ...nycStreetPermitSources,
  nycParkingMeters,
  nycEvChargers,
  afdcNewJerseyChargers,
  nycDefibrillators,
  nycPublicRestrooms,
  nycLandmarks,
];

export { createParkingSignsReader } from './parking-signs.js';
export { createPermitStipulationsReader } from './permit-stipulations.js';
