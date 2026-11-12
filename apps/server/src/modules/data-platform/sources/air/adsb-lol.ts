import type { SourceDefinition } from '../../definition.js';
import { olderThanServed } from '../city/parsing.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import { ADSB_FI_ID } from './adsb-fi.js';
import {
  ANSWER_FAILURES,
  AREA,
  airTrafficSchema,
  parseAirTraffic,
  type AirTraffic,
} from './aircraft.js';

/**
 * Aircraft around JFK, LaGuardia and Newark from adsb.lol, a network of volunteer receivers.
 *
 * Rhythm and freshness: positions are seconds old (`seen_pos` under a minute on 11/11/2026), but
 * the API allows 500 requests a day without a key (`x-ratelimit-limit: 500;w=86400`). Every 10
 * minutes at rest and every 5 while a trip is watched stays under 288 a day; a quarter of an hour
 * without a new answer degrades it, and adsb.fi stands in.
 *
 * Licence: ODbL 1.0 (https://www.adsb.lol/docs/open-data/api/), which requires attribution.
 */
export const adsbLolSource: SourceDefinition<AirTraffic> = {
  id: 'adsb-lol-new-york',
  title: 'Aircraft around the New York airports',
  provider: 'adsb.lol',
  licence: {
    name: 'Open Database License (ODbL) 1.0',
    url: 'https://opendatacommons.org/licenses/odbl/1.0/',
    attribution: 'Aircraft positions from adsb.lol, available under the ODbL 1.0',
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
      url: `https://api.adsb.lol/v2/point/${String(latitude)}/${String(longitude)}/${String(radiusNm)}`,
      headers: { accept: 'application/json' },
    };
  },
  parse(body, { receivedAt }) {
    return parseAirTraffic(body, receivedAt, { list: 'ac', nowUnit: 'ms' });
  },
  check(data, previous) {
    return olderThanServed(data.answeredAt, previous?.answeredAt);
  },
  consumers: ['live-map', 'flights'],
  fallback: ADSB_FI_ID,
  failures: [
    ...httpFailures('api.adsb.lol', 'https://www.adsb.lol/docs/open-data/api/'),
    {
      code: 'http-429',
      detection: 'adsb.lol answers 429: its limit of 500 requests a day, or a dynamic one, is hit',
      state: 'rate_limited',
      remedy: 'Wait for Retry-After; adsb.fi stands in and the last positions keep their age',
    },
    ...ANSWER_FAILURES,
  ],
};
