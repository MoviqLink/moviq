import { toInstant, type ExclusionReason, type LiveStation } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import type { FreeVehicles } from '../../data-platform/sources/micromobility/free-vehicles.js';
import { fleetSources } from '../../data-platform/sources/micromobility/operators.js';
import { liveSource } from '../sources.js';
import { createTally, type LiveModeFeed } from './feed.js';

type Parked = Extract<LiveStation, { mode: 'micromobility' }>;
type Vehicle = FreeVehicles['vehicles'][number];

/** The operator of each fleet, as its riders know it. */
const OPERATORS = new Map([
  ['lime-new-york', 'Lime'],
  ['veo-bronx', 'Veo'],
  ['veo-queens', 'Veo'],
  ['bird-new-york', 'Bird'],
]);

/** A vehicle free to rent where it stands, or why it is left out. */
function parkedOf(
  vehicle: Vehicle,
  data: FreeVehicles,
  source: SourceDefinition<FreeVehicles>,
  operator: string,
  now: Date,
): Parked | ExclusionReason {
  if (vehicle.reserved || vehicle.disabled) return 'not-in-service';
  // Without a report of its own, a vehicle is as fresh as the operator's file.
  const reportedAt = vehicle.reportedAt ?? data.updatedAt;
  if (now.getTime() - Date.parse(reportedAt) > source.freshness.staleAfterMs) {
    return 'stale-position';
  }
  return {
    mode: 'micromobility',
    // A rotating id names this answer's vehicle only, so it is drawn anew with each answer.
    id: `micromobility:${source.id}:${vehicle.vehicleId}`,
    sourceId: source.id,
    name: operator,
    lat: vehicle.latitude,
    lon: vehicle.longitude,
    kind: vehicle.kind,
    rangeMeters: vehicle.rangeMetres,
    battery: vehicle.battery,
    stableId: data.vehicleIds === 'stable',
    reportedAt: toInstant(new Date(reportedAt)),
  };
}

/**
 * Shared scooters and bikes parked in the street, free to rent: one fleet per operator and area.
 * Reserved and disabled vehicles are left out, and so are those not reported for 30 minutes.
 */
function createFleetFeed(source: SourceDefinition<FreeVehicles>): LiveModeFeed {
  const operator = OPERATORS.get(source.id) ?? source.provider;
  return {
    mode: 'micromobility',
    interestSourceIds: [source.id],
    async read(context) {
      const reading = await context.reader.read(source);
      const { data } = reading;
      const tally = createTally();
      const stations: LiveStation[] = [];
      const parked =
        data === undefined
          ? []
          : data.vehicles.map((vehicle) => parkedOf(vehicle, data, source, operator, context.now));
      for (const shown of parked) {
        if (typeof shown === 'string') tally.add(shown);
        else stations.push(shown);
      }
      return {
        vehicles: [],
        stations,
        excluded: tally.counts,
        sources: [liveSource(source, reading)],
        liveSourceIds: [source.id],
      };
    },
  };
}

/** Lime, Veo in the Bronx and in Queens, and Bird. */
export const createMicromobilityFeeds = (): LiveModeFeed[] => fleetSources.map(createFleetFeed);
