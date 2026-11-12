import { toInstant, type LivePosition } from '@moviq/contracts';

import {
  publishedPosition,
  type GpsEstimateInput,
  type PlacedStop,
  type PositionEstimator,
  type StationEstimateInput,
} from '../estimate.js';
import {
  betweenStations,
  notLeft,
  remember,
  type Departure,
  type ListedStop,
  type StallEvidence,
  type TrainMemory,
} from './between-stations.js';
import {
  OFF_LINE_METERS,
  filterFor,
  follow,
  metersAt,
  type GpsTrack,
  type StopAhead,
} from './gps-plus.js';
import { place, pointAt, type Line } from './line.js';
import {
  noStatistics,
  usableMargin,
  usableSpeed,
  type EstimationStatistics,
} from './statistics.js';

/**
 * A position is `gps`, the report itself, while what would be drawn is within 10 m of a report
 * under 60 s old: Vektia's rule (`gps-plus.js`, `AQUI_M` and `RECIENTE_S`). Otherwise it is
 * `gps-plus`, estimated from the report.
 */
const AS_REPORTED_METERS = 10;
const AS_REPORTED_MS = 60_000;
/** A vehicle not seen for this long is forgotten: its sources are unavailable by then. */
const FORGET_AFTER_MS = 15 * 60_000;
/** How often vehicles not seen are looked for. */
const SWEEP_MS = 60_000;
/** Only the next few stops ahead can be reached before the next report. */
const STOPS_LOOKED_AT = 3;

interface Kept<T> {
  readonly value: T;
  readonly seenAt: number;
}

const timeOf = (text: string | null) => (text === null ? null : Date.parse(text));

/** The first of the next stops placed ahead of `from` on the line, with when it is left. */
function nextStopOn(line: Line, stops: readonly PlacedStop[], from: number): StopAhead | undefined {
  for (const stop of stops.slice(0, STOPS_LOOKED_AT)) {
    const leavesAt = timeOf(stop.departure ?? stop.arrival);
    const placement = place(line, stop, from);
    if (leavesAt === null || placement.offsetMeters > OFF_LINE_METERS) continue;
    if (placement.meters > from) return { meters: placement.meters, leavesAt };
  }
  return undefined;
}

function gpsPosition(
  input: GpsEstimateInput,
  tracks: Map<string, Kept<GpsTrack>>,
  statistics: EstimationStatistics,
): LivePosition {
  const { line } = input;
  const now = input.now.getTime();
  const typicalAt = (meters: number) =>
    line === undefined
      ? null
      : (usableSpeed(statistics.segments.typicalSpeed(input.route, line, meters, input.now))
          ?.metersPerSecond ?? null);
  const previous = tracks.get(input.vehicleId)?.value;
  const filter = filterFor(input.mode);
  const followed =
    line === undefined
      ? undefined
      : follow(
          previous,
          {
            route: input.route,
            direction: input.direction,
            line,
            point: input.latest,
            at: input.latest.at,
          },
          previous === undefined ? null : typicalAt(previous.report.meters),
          filter,
        );
  if (line === undefined || followed === undefined) {
    tracks.delete(input.vehicleId);
    return publishedPosition(input);
  }
  const { report } = followed.track;
  const next = nextStopOn(line, input.stopsAhead, report.meters);
  const drawn = metersAt(followed.track, line, now, typicalAt(report.meters), next, filter);
  tracks.set(input.vehicleId, { value: drawn.track, seenAt: now });
  const age = now - report.at;
  const dataTime = toInstant(new Date(report.at));
  if (age <= AS_REPORTED_MS && Math.abs(drawn.meters - report.meters) <= AS_REPORTED_METERS) {
    return {
      lat: report.lat,
      lon: report.lon,
      basis: 'gps',
      marginMeters: null,
      dataTime,
      station: null,
      stall: null,
    };
  }
  const margin = usableMargin(statistics.tracking.forAge(input.mode, input.route, age / 1000));
  return {
    ...pointAt(line, drawn.meters),
    basis: 'gps-plus',
    marginMeters: margin?.p90Meters ?? null,
    dataTime,
    station: null,
    stall: null,
  };
}

function listed(stop: PlacedStop): ListedStop {
  return {
    id: stop.id,
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    arrival: timeOf(stop.arrival),
    departure: timeOf(stop.departure),
  };
}

/** The evidence of a possible stoppage, with the stop the train left, as Explore shows it. */
function stallOf(stall: StallEvidence | null, departure: Departure): LivePosition['stall'] {
  if (stall === null) return null;
  return { ...stall, leftStop: { id: departure.from.id, name: departure.from.name } };
}

function stationPosition(
  input: StationEstimateInput,
  trains: Map<string, Kept<TrainMemory>>,
  statistics: EstimationStatistics,
): LivePosition {
  const { line, next } = input;
  const now = input.now.getTime();
  if (next === undefined) {
    trains.delete(input.vehicleId);
    return publishedPosition(input);
  }
  const first = listed(next);
  const ahead = notLeft(line, first, listed(input.station));
  const memory = remember(
    trains.get(input.vehicleId)?.value,
    ahead,
    input.predictedAt.getTime(),
    ahead === first ? undefined : input.observedAt.getTime(),
  );
  trains.set(input.vehicleId, { value: memory, seenAt: now });
  const { departure } = memory;
  const atStation = input.station.status === 'stopped' && input.station.id === ahead.id;
  if (line === undefined || atStation || departure?.to !== ahead.id) {
    return publishedPosition(input);
  }
  const estimate = betweenStations(
    {
      route: input.route,
      line,
      departure,
      next: ahead,
      now,
      predictedAt: input.predictedAt.getTime(),
    },
    statistics,
  );
  if (estimate === undefined) return publishedPosition(input);
  const meters = Math.max(memory.drawn ?? estimate.meters, estimate.meters);
  trains.set(input.vehicleId, { value: { ...memory, drawn: meters }, seenAt: now });
  return {
    ...pointAt(line, meters),
    basis: 'predicted',
    marginMeters: estimate.marginMeters,
    dataTime: toInstant(input.predictedAt),
    station: {
      id: ahead.id,
      name: ahead.name,
      status: input.station.id === ahead.id ? input.station.status : 'heading',
    },
    stall: stallOf(estimate.stall, departure),
  };
}

function forgetUnseen<T>(kept: Map<string, Kept<T>>, now: number): void {
  for (const [id, entry] of kept) {
    if (now - entry.seenAt > FORGET_AFTER_MS) kept.delete(id);
  }
}

/**
 * The estimator Explore draws with: buses along the line of their trip between GPS reports
 * (`gps-plus.ts`) and subway trains between the stop they left and the next one
 * (`between-stations.ts`), with margins only where the recorder has measured them. What it
 * learns of each vehicle lives in memory and is forgotten 15 minutes after it was last seen.
 */
export function createPositionEstimator(
  statistics: EstimationStatistics = noStatistics,
): PositionEstimator {
  const tracks = new Map<string, Kept<GpsTrack>>();
  const trains = new Map<string, Kept<TrainMemory>>();
  let sweptAt = Number.NEGATIVE_INFINITY;
  return (input) => {
    const now = input.now.getTime();
    if (now - sweptAt >= SWEEP_MS) {
      forgetUnseen(tracks, now);
      forgetUnseen(trains, now);
      sweptAt = now;
    }
    return input.kind === 'gps'
      ? gpsPosition(input, tracks, statistics)
      : stationPosition(input, trains, statistics);
  };
}
