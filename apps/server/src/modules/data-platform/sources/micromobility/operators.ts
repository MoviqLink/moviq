import type { Licence, SourceDefinition } from '../../definition.js';
import { HOUR, MINUTE } from '../mta/provider.js';
import { httpFailures } from '../regional/provider-failures.js';
import {
  FLEET_FAILURES,
  checkFleet,
  freeVehiclesSchema,
  parseFreeVehicles,
  type FleetDialect,
  type FreeVehicles,
  type VehicleKind,
} from './free-vehicles.js';

interface Fleet {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly licence: Licence;
  readonly url: string;
  readonly dialect: FleetDialect;
}

const SCOOTER: VehicleKind = 'scooter';
const EBIKE: VehicleKind = 'e-bike';

/** Veo's `vehicle_types` (the same in the Bronx and Queens on 11/11/2026). */
const VEO_KINDS = new Map<string, VehicleKind>([
  ['0', 'bike'],
  ['1', SCOOTER],
  ['2', EBIKE],
  ['3', EBIKE],
  ['4', SCOOTER],
  ['5', SCOOTER],
]);

/** Veo declares no licence in its `system_information` (11/11/2026). */
const VEO_LICENCE: Licence = {
  name: 'No published terms (public GBFS feed)',
  url: 'https://www.veoride.com',
  attribution: 'Vehicle data from Veo',
};

const VEO_URL = 'https://cluster-prod.veoride.com/api/shares/name/';

const FLEETS: readonly Fleet[] = [
  {
    id: 'lime-new-york',
    title: 'Lime scooters (Bronx and Queens)',
    provider: 'Lime (GBFS 2.2)',
    // `license_url` of `system_information`; the page answers 403 behind a browser check to a
    // plain request (11/11/2026), so its text is not yet read.
    licence: {
      name: 'Lime GBFS terms',
      url: 'https://www.li.me/gbfs-terms',
      attribution: 'Vehicle data from Lime',
    },
    url: 'https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status',
    dialect: {
      vehicleIds: 'rotating',
      kinds: new Map([
        ['1', SCOOTER],
        ['2', SCOOTER],
        ['3', EBIKE],
        ['4', 'bike'],
      ]),
    },
  },
  {
    id: 'veo-bronx',
    title: 'Veo e-bikes and scooters (Bronx)',
    provider: 'Veo (GBFS 2.2)',
    licence: VEO_LICENCE,
    url: `${VEO_URL}nyc/gbfs/free_bike_status`,
    dialect: { vehicleIds: 'stable', kinds: VEO_KINDS },
  },
  {
    id: 'veo-queens',
    title: 'Veo e-bikes and scooters (Queens)',
    provider: 'Veo (GBFS 2.2)',
    licence: VEO_LICENCE,
    url: `${VEO_URL}nyq/gbfs/free_bike_status`,
    dialect: { vehicleIds: 'stable', kinds: VEO_KINDS },
  },
  {
    id: 'bird-new-york',
    title: 'Bird scooters (Queens and Bronx)',
    provider: 'Bird Rides, Inc. (GBFS 2.3)',
    // `license_url` of `system_information`, a PDF of 2018 that answers 404 (11/11/2026).
    licence: {
      name: 'Bird GBFS Data License Agreement (2018-09-25)',
      url: 'https://www.bird.co/wp-content/uploads/2019/03/GBFS-Data-License-Agreement-2018-09-25.pdf',
      attribution: 'Vehicle data from Bird',
    },
    url: 'https://mds.bird.co/gbfs/v2/public/new-york/free_bike_status.json',
    dialect: {
      vehicleIds: 'rotating',
      kinds: new Map([
        ['bae2102b-56ba-42ba-9097-720e5990b4b2', SCOOTER],
        ['2ea3c8b2-ed07-4c53-b87e-638c08471309', EBIKE],
      ]),
    },
  },
];

/**
 * Rhythm and freshness: Lime and Bird publish with `ttl` 60, Veo makes the file on each request.
 * Parked vehicles move only when rented, so every 5 minutes at rest and every minute while a trip
 * is watched; ten minutes without a newer file degrade it.
 */
function fleetSource(fleet: Fleet): SourceDefinition<FreeVehicles> {
  const host = new URL(fleet.url).host;
  return {
    id: fleet.id,
    title: fleet.title,
    provider: fleet.provider,
    licence: fleet.licence,
    kind: 'realtime',
    rhythm: { class: 'hot', baseIntervalMs: 5 * MINUTE, interestIntervalMs: MINUTE },
    freshness: {
      degradedAfterMs: 10 * MINUTE,
      staleAfterMs: 30 * MINUTE,
      unavailableAfterMs: 2 * HOUR,
    },
    limits: { timeoutMs: 30_000, maxBytes: 6 * 1024 * 1024 },
    keepVersions: 1,
    dataSchema: freeVehiclesSchema,
    request() {
      return { url: fleet.url, headers: { accept: 'application/json' } };
    },
    parse(body, { receivedAt }) {
      return parseFreeVehicles(body, receivedAt, fleet.dialect);
    },
    check(data, previous) {
      return checkFleet(data, previous);
    },
    consumers: ['live-map', 'trip-planning'],
    failures: [...httpFailures(host, fleet.licence.url), ...FLEET_FAILURES],
  };
}

/** Lime, Veo (Bronx and Queens) and Bird: shared vehicles parked in the street, from GBFS. */
export const fleetSources: readonly SourceDefinition<FreeVehicles>[] = FLEETS.map(fleetSource);
