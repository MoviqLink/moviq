import type { SourceDefinition } from '../../definition.js';
import { faaAirportStatusSource } from './faa-airport-status.js';
import { nwsAlertsSource } from './nws-alerts.js';
import { nwsHourlyForecastSource } from './nws-hourly-forecast.js';
import { nycDotTrafficSpeedsSource } from './nyc-dot-traffic-speeds.js';

/** New York airports, road traffic and weather, collected on the warm rhythm. */
export const citySources: readonly SourceDefinition[] = [
  faaAirportStatusSource,
  nycDotTrafficSpeedsSource,
  nwsAlertsSource,
  nwsHourlyForecastSource,
];
