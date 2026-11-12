import type { ProductFeature } from '@moviq/contracts';

import type { KnownFailure, SourceDefinition } from '../../definition.js';
import { olderThanServed } from '../city/parsing.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  parsePortsAnswer,
  portsReadingSchema,
  type Measure,
  type PortsReading,
} from './noaa-ports-reading.js';

const API_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * NOAA asks every caller for an `application` name, to trace problems in its logs. A neutral,
 * descriptive value that names no project, company or person keeps the network identity generic.
 */
const APPLICATION = 'public-transit-viewer';

interface PortsStation {
  readonly id: string;
  readonly station: string;
  readonly measure: Measure;
  readonly title: string;
  /** The product and the period: the latest value where it answered, else the last hour. */
  readonly query: string;
  readonly consumers: readonly ProductFeature[];
}

function failuresOf(station: PortsStation): readonly KnownFailure[] {
  return [
    ...httpFailures(
      'api.tidesandcurrents.noaa.gov',
      'https://api.tidesandcurrents.noaa.gov/api/prod/',
    ),
    {
      code: 'not-json',
      detection: 'The body is not JSON, as an HTML error page',
      state: 'degraded',
      remedy: 'Keep the last reading with its age; the next run tries again',
    },
    {
      code: 'no-data',
      detection: `NOAA answers "No data was found" for station ${station.station}, as when it is down`,
      state: 'degraded',
      remedy: 'The last reading ages and its state follows; NOAA lists outages on its station page',
    },
    {
      code: 'unexpected-shape',
      detection: 'No metadata or data list, or a station without its place',
      state: 'misconfigured',
      remedy: 'NOAA changed its answer: compare with the capture and update the reader',
    },
    {
      code: 'wrong-station',
      detection: 'The answer names another station than the one asked for',
      state: 'misconfigured',
      remedy: 'An operator checks the station id against the NOAA station list',
    },
    {
      code: 'older-than-served',
      detection: 'The newest reading is earlier than the one served',
      state: 'degraded',
      remedy: 'Keep the newer reading; the next run normally brings a current one',
    },
  ];
}

/**
 * One measure of the New York and New Jersey Harbor PORTS, NOAA's real-time system for ships.
 *
 * Rhythm and freshness: stations measure every 6 minutes and publish within minutes (on
 * 11/11/2026 the 03:30 UTC values answered at 03:40), so a read every 6 minutes takes each value
 * once; the newest value of the answer is kept. 20 minutes without a newer value (three missed
 * measurements) degrade it, an hour makes it stale.
 */
function portsSource(station: PortsStation): SourceDefinition<PortsReading> {
  const query = new URLSearchParams({
    station: station.station,
    ...Object.fromEntries(new URLSearchParams(station.query)),
    units: 'metric',
    time_zone: 'gmt',
    format: 'json',
    application: APPLICATION,
  });
  return {
    id: station.id,
    title: station.title,
    provider: 'NOAA Center for Operational Oceanographic Products and Services (CO-OPS), PORTS',
    licence: {
      name: 'U.S. Government work, public domain',
      url: 'https://tidesandcurrents.noaa.gov/disclaimers.html',
      attribution: 'NOAA Tides and Currents, New York and New Jersey Harbor PORTS',
    },
    kind: 'realtime',
    rhythm: { class: 'warm', baseIntervalMs: 6 * MINUTE },
    freshness: { degradedAfterMs: 20 * MINUTE, staleAfterMs: HOUR, unavailableAfterMs: 3 * HOUR },
    limits: { timeoutMs: 20_000, maxBytes: 256 * 1024 },
    keepVersions: 1,
    dataSchema: portsReadingSchema,
    request() {
      return { url: `${API_URL}?${query.toString()}`, headers: { accept: 'application/json' } };
    },
    parse(body) {
      return parsePortsAnswer(body, station.station, station.measure);
    },
    check(data, previous) {
      return olderThanServed(data.observation.observedAt, previous?.observation.observedAt);
    },
    consumers: station.consumers,
    failures: failuresOf(station),
  };
}

/**
 * The four stations that answered on 11/11/2026. The Narrows currents (`n03020`) and the wind at
 * The Battery gave no data that night, so Kill Van Kull and Robbins Reef stand for them.
 */
export const portsSources = [
  portsSource({
    id: 'noaa-ports-battery-water-level',
    station: '8518750',
    measure: 'water-level',
    title: 'NOAA PORTS water level at The Battery',
    query: 'product=water_level&datum=MLLW&date=latest',
    consumers: ['live-map'],
  }),
  portsSource({
    id: 'noaa-ports-verrazzano-air-gap',
    station: '8517986',
    measure: 'air-gap',
    title: 'NOAA PORTS air gap under the Verrazzano-Narrows Bridge',
    query: 'product=air_gap&date=latest',
    consumers: ['live-map'],
  }),
  portsSource({
    id: 'noaa-ports-kill-van-kull-current',
    station: 'n06010',
    measure: 'current',
    title: 'NOAA PORTS current in the Kill Van Kull',
    query: 'product=currents&range=1',
    consumers: ['live-map'],
  }),
  portsSource({
    id: 'noaa-ports-robbins-reef-wind',
    station: '8530973',
    measure: 'wind',
    title: 'NOAA PORTS wind at Robbins Reef',
    query: 'product=wind&range=1',
    consumers: ['live-map', 'weather'],
  }),
] as const;
