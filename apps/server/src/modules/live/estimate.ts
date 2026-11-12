import { toInstant, type LivePosition, type VehicleMode } from '@moviq/contracts';

import type { Line } from './estimation/line.js';
import type { Point } from './geo.js';
import type { Fix } from './motion.js';

/** A stop ahead with where it is and the predicted times of this vehicle. */
export interface PlacedStop extends Point {
  readonly id: string;
  readonly name: string;
  readonly arrival: string | null;
  readonly departure: string | null;
}

/** A vehicle that reports GPS: its last report, the line of its trip and its stops ahead. */
export interface GpsEstimateInput {
  readonly kind: 'gps';
  /** Stable while the vehicle runs, as the id it is shown with. */
  readonly vehicleId: string;
  readonly now: Date;
  readonly mode: VehicleMode;
  readonly route: string;
  readonly direction: 0 | 1 | null;
  /** The shape of its trip, or undefined when no timetable gives one. */
  readonly line: Line | undefined;
  readonly latest: Fix;
  readonly stopsAhead: readonly PlacedStop[];
}

/** A train without GPS: the station it is at or heading to, and the first stop it has not left. */
export interface StationEstimateInput {
  readonly kind: 'station';
  readonly vehicleId: string;
  readonly now: Date;
  readonly mode: VehicleMode;
  readonly route: string;
  readonly line: Line | undefined;
  readonly station: PlacedStop & { readonly status: 'stopped' | 'arriving' | 'heading' };
  /** When the operator last placed the train. */
  readonly observedAt: Date;
  /** The first stop the operator lists for the trip, which the train has not left yet. */
  readonly next: PlacedStop | undefined;
  /** When the operator published the times read. */
  readonly predictedAt: Date;
}

export type EstimateInput = GpsEstimateInput | StationEstimateInput;

/**
 * Where a vehicle is drawn now. The estimator of `estimation/` keeps what it learns of each
 * vehicle between calls, so the feeds only say what they read.
 */
export type PositionEstimator = (input: EstimateInput) => LivePosition;

/**
 * Only what was published, with no estimate: the last GPS report as `gps`, and a train at the
 * station it is at or heading to as `predicted`. Neither has a measured margin. The estimator
 * falls back on it when a vehicle cannot be placed on the line of its trip.
 */
export function publishedPosition(input: EstimateInput): LivePosition {
  if (input.kind === 'gps') {
    return {
      lat: input.latest.lat,
      lon: input.latest.lon,
      basis: 'gps',
      marginMeters: null,
      dataTime: toInstant(new Date(input.latest.at)),
      station: null,
      stall: null,
    };
  }
  const { station } = input;
  return {
    lat: station.lat,
    lon: station.lon,
    basis: 'predicted',
    marginMeters: null,
    dataTime: toInstant(input.observedAt),
    station: { id: station.id, name: station.name, status: station.status },
    stall: null,
  };
}
