import { citiBikeStatusSource } from '../../data-platform/sources/bikes/citi-bike.js';
import { fleetSources } from '../../data-platform/sources/micromobility/operators.js';
import { unixSeconds, type ExtractedEvent } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';

/** Each day starts with every value, so a day of samples reads on its own. */
const DAILY = { mode: null, restartsDaily: true } as const;

/**
 * Shared vehicles are counted by cell of a hundredth of a degree (about 1.1 km by 0.8 km in New
 * York): most systems rotate vehicle ids on every answer, so a vehicle cannot be followed, and a
 * count per cell says where they are without that.
 */
const CELL_DEGREES = 0.01;

type Counts = Readonly<Record<string, number>>;

/** Keeps the last counts of each key and writes a sample only when they change. */
function createCountSampler() {
  const last = new Map<string, string>();
  return (key: string, t: number, value: Counts): ExtractedEvent[] => {
    const text = JSON.stringify(value);
    if (last.get(key) === text) return [];
    last.set(key, text);
    return [{ k: 'sample', t, key, value }];
  };
}

const corner = (degrees: number): string =>
  (Math.floor(degrees / CELL_DEGREES) * CELL_DEGREES).toFixed(2);

export const cellOf = (latitude: number, longitude: number): string =>
  `${corner(latitude)},${corner(longitude)}`;

/** Citi Bike: each station when its bikes, e-bikes or free docks change. */
const stationCounts = extractorFor(citiBikeStatusSource, DAILY, () => {
  const sample = createCountSampler();
  return (data) =>
    data.stations.flatMap((station) =>
      sample(station.stationId, unixSeconds(station.reportedAt ?? data.updatedAt), {
        bikes: station.bikes,
        ebikes: station.ebikes,
        docks: station.docks,
        renting: station.renting ? 1 : 0,
      }),
    );
});

/** Scooters and e-bikes of each operator: ready, reserved and disabled vehicles by cell. */
const fleetCounts = fleetSources.map((definition) =>
  extractorFor(definition, DAILY, () => {
    const sample = createCountSampler();
    return (data) => {
      const t = unixSeconds(data.updatedAt);
      const cells = new Map<string, { ready: number; reserved: number; disabled: number }>();
      for (const vehicle of data.vehicles) {
        const cell = cellOf(vehicle.latitude, vehicle.longitude);
        const counts = cells.get(cell) ?? { ready: 0, reserved: 0, disabled: 0 };
        if (vehicle.disabled) counts.disabled += 1;
        else if (vehicle.reserved) counts.reserved += 1;
        else counts.ready += 1;
        cells.set(cell, counts);
      }
      const total = { vehicles: data.vehicles.length, cells: cells.size };
      return [
        ...sample('total', t, total),
        ...[...cells]
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([cell, counts]) => sample(cell, t, counts)),
      ];
    };
  }),
);

export const countExtractors: readonly Extractor[] = [stationCounts, ...fleetCounts];
