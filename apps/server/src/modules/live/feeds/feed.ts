import type {
  ExclusionReason,
  LiveMode,
  LiveSource,
  LiveStation,
  LiveVehicle,
  TimedStop,
} from '@moviq/contracts';

import type { SourceReader } from '../../data-platform/reader.js';
import type { PlacedStop, PositionEstimator } from '../estimate.js';
import type { Timetable, Timetables } from '../timetable.js';

export interface FeedContext {
  readonly reader: SourceReader;
  readonly now: Date;
  readonly timetables: Timetables;
  readonly estimate: PositionEstimator;
}

/** What one mode shows now, what it leaves out and the sources it rests on. */
export interface ModeReading {
  readonly vehicles: readonly LiveVehicle[];
  readonly stations: readonly LiveStation[];
  readonly excluded: ReadonlyMap<ExclusionReason, number>;
  /** Every source read, live and static, with its state. */
  readonly sources: readonly LiveSource[];
  /** The ids of the live sources among them: without data in any, the mode is unavailable. */
  readonly liveSourceIds: readonly string[];
}

/**
 * One mode of transport on the map. Each feed reads its sources through the platform and keeps
 * only what can be followed; a new mode is one more feed.
 */
export interface LiveModeFeed {
  readonly mode: LiveMode;
  /** The live sources a screen showing this mode registers interest in. */
  readonly interestSourceIds: readonly string[];
  read(context: FeedContext): Promise<ModeReading>;
}

/** Counts why vehicles are left out. */
export function createTally() {
  const counts = new Map<ExclusionReason, number>();
  return {
    counts: counts as ReadonlyMap<ExclusionReason, number>,
    add(reason: ExclusionReason, many = 1): void {
      if (many > 0) counts.set(reason, (counts.get(reason) ?? 0) + many);
    },
  };
}

interface PredictedStop {
  readonly stopId: string;
  readonly arrival: string | null;
  readonly departure: string | null;
}

/** A predicted time this long past still counts as ahead: the vehicle may be at that stop now. */
const JUST_PASSED_MS = 60_000;

const timeOf = (stop: PredictedStop) => Date.parse(stop.departure ?? stop.arrival ?? '');

/**
 * The stops still ahead at `now`, in order, with their names and places from the timetable. A
 * stop the timetable does not know is skipped: it cannot be named or placed.
 */
export function stopsAhead(
  stops: readonly PredictedStop[],
  timetable: Timetable,
  now: Date,
): PlacedStop[] {
  const from = now.getTime() - JUST_PASSED_MS;
  return stops.flatMap((stop) => {
    const known = timetable.stop(stop.stopId);
    if (known === undefined || !(timeOf(stop) >= from)) return [];
    return [
      {
        id: stop.stopId,
        name: known.name,
        lat: known.lat,
        lon: known.lon,
        arrival: stop.arrival,
        departure: stop.departure,
      },
    ];
  });
}

export const timedStop = (stop: PlacedStop): TimedStop => ({
  id: stop.id,
  name: stop.name,
  arrival: stop.arrival,
  departure: stop.departure,
});
