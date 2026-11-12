import type { AirportCode } from '@moviq/contracts';

import { AIRPORT_ICAO } from '../data-platform/on-demand/aerodatabox-fids.js';
import type { Point } from '../live/geo.js';

export interface Airport extends Point {
  readonly code: AirportCode;
  readonly icao: string;
  readonly name: string;
}

/**
 * The airport reference points of the FAA Airport Master Records (form 5010), in decimal
 * degrees, the same Explore draws the airports at.
 */
export const AIRPORTS: Readonly<Record<AirportCode, Airport>> = {
  JFK: {
    code: 'JFK',
    icao: AIRPORT_ICAO.JFK,
    name: 'John F. Kennedy International',
    lat: 40.639928,
    lon: -73.778693,
  },
  LGA: { code: 'LGA', icao: AIRPORT_ICAO.LGA, name: 'LaGuardia', lat: 40.77725, lon: -73.872611 },
  EWR: {
    code: 'EWR',
    icao: AIRPORT_ICAO.EWR,
    name: 'Newark Liberty International',
    lat: 40.692481,
    lon: -74.168686,
  },
};

export const AIRPORT_CODES: readonly AirportCode[] = ['JFK', 'LGA', 'EWR'];
