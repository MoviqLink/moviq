import type { SourceDefinition } from '../../definition.js';
import { adsbFiSource } from './adsb-fi.js';
import { adsbLolSource } from './adsb-lol.js';
import { adsbRoutesSource } from './adsb-routes.js';

/** Aircraft around JFK, LaGuardia and Newark, with a stand-in, and the usual routes of flights. */
export const airSources: readonly SourceDefinition[] = [
  adsbLolSource,
  adsbFiSource,
  adsbRoutesSource,
];
