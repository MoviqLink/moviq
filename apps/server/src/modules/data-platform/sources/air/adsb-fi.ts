import type { SourceDefinition } from '../../definition.js';
import { olderThanServed } from '../city/parsing.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  ANSWER_FAILURES,
  AREA,
  airTrafficSchema,
  parseAirTraffic,
  type AirTraffic,
} from './aircraft.js';

export const ADSB_FI_ID = 'adsb-fi-new-york';

/**
 * The same circle from adsb.fi, the stand-in for adsb.lol: the same ADS-B Exchange v2 fields,
 * the list in `aircraft` and `now` in seconds.
 *
 * Rhythm: the public endpoints allow one request a second; as a stand-in it is read as often as
 * adsb.lol, with the same freshness.
 *
 * Terms (https://github.com/adsbfi/opendata): personal, non-commercial use only, no licensing or
 * sale of the data, and adsb.fi cited with a link to its home page.
 */
export const adsbFiSource: SourceDefinition<AirTraffic> = {
  id: ADSB_FI_ID,
  title: 'Aircraft around the New York airports (adsb.fi)',
  provider: 'adsb.fi',
  licence: {
    name: 'adsb.fi open data terms (personal, non-commercial use)',
    url: 'https://github.com/adsbfi/opendata',
    attribution: 'Aircraft positions from adsb.fi (https://adsb.fi)',
  },
  kind: 'realtime',
  rhythm: { class: 'hot', baseIntervalMs: 10 * MINUTE, interestIntervalMs: 5 * MINUTE },
  freshness: {
    degradedAfterMs: 15 * MINUTE,
    staleAfterMs: 30 * MINUTE,
    unavailableAfterMs: HOUR,
  },
  limits: { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: airTrafficSchema,
  request() {
    const { latitude, longitude, radiusNm } = AREA;
    return {
      url: `https://opendata.adsb.fi/api/v2/lat/${String(latitude)}/lon/${String(longitude)}/dist/${String(radiusNm)}`,
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parseAirTraffic(body, receivedAt, { list: 'aircraft', nowUnit: 's' });
  },
  check(data, previous) {
    return olderThanServed(data.answeredAt, previous?.answeredAt);
  },
  consumers: ['live-map', 'flights'],
  failures: [
    ...httpFailures('opendata.adsb.fi', 'https://github.com/adsbfi/opendata'),
    {
      code: 'http-429',
      detection: 'adsb.fi answers 429: more than one request a second from our address',
      state: 'rate_limited',
      remedy: 'Wait for Retry-After; the last positions are served with their age',
    },
    ...ANSWER_FAILURES,
  ],
};
