import type { SourceDefinition } from '../../definition.js';
import { nycParksEventsSource } from './nyc-parks.js';
import { ticketmasterSources } from './ticketmaster-windows.js';
import { brooklynParamountEventsSource, irvingPlazaEventsSource } from './venues.js';

export { eventListSchema, type EventList, type SourceEvent } from './event-data.js';
export { NYC_PARKS_TERMS_URL, nycParksEventsSource } from './nyc-parks.js';
export { TICKETMASTER_TERMS_URL, ticketmasterSources } from './ticketmaster-windows.js';
export {
  LIVE_NATION_TERMS_URL,
  brooklynParamountEventsSource,
  irvingPlazaEventsSource,
} from './venues.js';

/** Events of New York: Ticketmaster in fourteen windows, NYC Parks and two venues' own pages. */
export const eventSources: readonly SourceDefinition[] = [
  ...ticketmasterSources,
  nycParksEventsSource,
  irvingPlazaEventsSource,
  brooklynParamountEventsSource,
];
