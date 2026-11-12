import type { HeldEvent, RecordedEvent, StationEvent, TrainEvent } from '../events.js';
import type { RecorderMode } from '../extractor.js';

/**
 * A passage is timed when the provider gave its time, or when the window that holds it is at
 * most this wide: its middle is then off by 45 s at most. Wider windows (a missed version, a
 * bus that stopped reporting) keep their window but are not timed.
 */
const MAX_WINDOW_SECONDS = 90;

export interface Passage {
  readonly stop: string;
  readonly next: string | null;
  readonly lo: number;
  readonly hi: number;
  readonly exact: boolean;
  /** When it happened, or null when only a wide window is known. */
  readonly at: number | null;
}

export interface Trajectory {
  readonly mode: RecorderMode;
  readonly trip: string;
  readonly route: string;
  readonly direction: string | null;
  vehicle: string | null;
  readonly departures: Passage[];
  readonly arrivals: Passage[];
  /**
   * Subway: each stop the train reported leaving, at the time it gave as it first reported itself
   * no longer stopped there (heading to the next stop, or between stations).
   */
  readonly leaves: Passage[];
  gpsReports: number;
}

/**
 * The passages that time a trip: arrivals reported by the train itself on the subway, where a
 * stop can stay listed after the train left; departures from Bus Time, whose next stop changes
 * as the bus leaves one.
 */
export function timingPassages(trajectory: Trajectory): readonly Passage[] {
  return trajectory.mode === 'subway' ? trajectory.arrivals : trajectory.departures;
}

export interface HeldReport {
  readonly mode: RecorderMode;
  readonly event: HeldEvent;
}

function passageOf(event: StationEvent): Passage {
  const narrow = event.hi - event.lo <= MAX_WINDOW_SECONDS;
  const at = event.exact ? event.t : narrow ? (event.lo + event.hi) / 2 : null;
  return { stop: event.stop, next: event.next, lo: event.lo, hi: event.hi, exact: event.exact, at };
}

const tripKey = (mode: RecorderMode, trip: string): string => `${mode}\u0000${trip}`;

const byTime = (a: Passage, b: Passage) => (a.at ?? a.hi) - (b.at ?? b.hi);

/** Puts the passages of a trajectory in time order, as every measure reads them. */
export function sortPassages(trajectory: Trajectory): void {
  trajectory.departures.sort(byTime);
  trajectory.arrivals.sort(byTime);
  trajectory.leaves.sort(byTime);
}

/** Rebuilds what each trip did during the day from its passages, GPS reports and holds. */
export function createTrajectories() {
  const trips = new Map<string, Trajectory>();
  const seenStops = new Map<string, Set<string>>();
  const vehicles = new Map<string, string>();
  const trains = new Map<string, TrainEvent>();
  const held: HeldReport[] = [];

  const ensure = (
    mode: RecorderMode,
    event: { trip: string; route: string; dir: string | null },
  ) => {
    const key = tripKey(mode, event.trip);
    const trajectory = trips.get(key) ?? {
      mode,
      trip: event.trip,
      route: event.route,
      direction: event.dir,
      vehicle: null,
      departures: [],
      arrivals: [],
      leaves: [],
      gpsReports: 0,
    };
    trips.set(key, trajectory);
    return trajectory;
  };

  const station = (mode: RecorderMode, event: StationEvent) => {
    const key = tripKey(mode, event.trip);
    const trajectory = ensure(mode, event);
    trajectory.vehicle ??= event.veh;
    const seen = seenStops.get(key) ?? new Set<string>();
    seenStops.set(key, seen);
    // The first passage of a trip at a stop stands; a later one is GPS noise or a replay.
    if (seen.has(`${event.ev}:${event.stop}`)) return;
    seen.add(`${event.ev}:${event.stop}`);
    (event.ev === 'dep' ? trajectory.departures : trajectory.arrivals).push(passageOf(event));
  };

  /** A train no longer stopped at the stop it was stopped at, now naming another, left it. */
  const train = (mode: RecorderMode, event: TrainEvent) => {
    const key = tripKey(mode, event.trip);
    const before = trains.get(key);
    trains.set(key, event);
    if (before?.status !== 'stopped' || before.stop === null || event.status === 'stopped') return;
    if (event.stop === null || event.stop === before.stop || event.t < before.t) return;
    const at = event.t;
    ensure(mode, event).leaves.push({
      stop: before.stop,
      next: event.stop,
      lo: at,
      hi: at,
      exact: true,
      at,
    });
  };

  return {
    add(mode: RecorderMode, event: RecordedEvent): void {
      // Only these kinds describe trips; the others are read by other passes.
      if (event.k === 'stn') station(mode, event);
      else if (event.k === 'train') train(mode, event);
      else if (event.k === 'held') held.push({ mode, event });
      else if (event.k === 'assign') {
        vehicles.set(tripKey(mode, event.veh), tripKey(mode, event.trip));
        ensure(mode, event).vehicle = event.veh;
      } else if (event.k === 'gps') {
        const trip = vehicles.get(tripKey(mode, event.veh));
        const trajectory = trip === undefined ? undefined : trips.get(trip);
        if (trajectory !== undefined) trajectory.gpsReports += 1;
      }
    },

    /** Every trajectory, with its passages in time order. */
    all(): readonly Trajectory[] {
      for (const trajectory of trips.values()) sortPassages(trajectory);
      return [...trips.values()];
    },

    /** Every trajectory as read, for callers that sort the ones they measure. */
    unsorted(): readonly Trajectory[] {
      return [...trips.values()];
    },

    find(mode: RecorderMode, trip: string): Trajectory | undefined {
      return trips.get(tripKey(mode, trip));
    },

    held(): readonly HeldReport[] {
      return held;
    },
  };
}

export type Trajectories = ReturnType<typeof createTrajectories>;
