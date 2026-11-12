import type { SourceDefinition } from '../../definition.js';
import { ny511Cameras } from './cameras.js';
import { ny511CrossingTimes } from './crossing-times.js';
import {
  ny511Closures,
  ny511Construction,
  ny511FutureConstruction,
  ny511Incidents,
  ny511SpecialEvents,
  ny511TransitEvents,
  ny511WeatherWarnings,
} from './event-layers.js';
import { ny511MessageSigns } from './message-signs.js';
import { ny511RoadConditions } from './road-conditions.js';

/** 511NY's map layers, one source each, cut to the city and its approaches. Waze is not read. */
export const ny511Sources: readonly SourceDefinition[] = [
  ny511Closures,
  ny511Incidents,
  ny511Construction,
  ny511FutureConstruction,
  ny511SpecialEvents,
  ny511TransitEvents,
  ny511WeatherWarnings,
  ny511RoadConditions,
  ny511MessageSigns,
  ny511Cameras,
  ny511CrossingTimes,
];
