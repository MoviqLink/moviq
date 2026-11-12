import type { Provenance } from '@moviq/contracts';

import type { PredictedStop } from '../../data-platform/sources/mta/realtime-feed.js';
import type {
  GtfsRoute,
  GtfsService,
  GtfsStop,
  GtfsTransfer,
  GtfsTrip,
} from '../../data-platform/sources/mta/gtfs-static-schema.js';

export { NO_DROP_OFF, NO_PICKUP } from '../../data-platform/sources/mta/stop-times-codec.js';
export type { GtfsTransfer } from '../../data-platform/sources/mta/gtfs-static-schema.js';

/**
 * What the engine reads, behind a port so it never touches the database: one static timetable per
 * GTFS file and the live predictions, each with its provenance. The GTFS index of the data
 * platform supplies routes, stops, trips and services; stop times, transfers and step-free
 * boarding are the parts the engine needs on top of it.
 */

/**
 * Every stop time of a feed in flat columns, a few bytes per call instead of an object: trip `t`
 * calls at `tripStart[t]..tripStart[t + 1]`, in `stop_sequence` order.
 */
export interface StopTimeColumns {
  readonly trips: readonly string[];
  readonly tripStart: Int32Array;
  /** Stop ids, named by index in `stop`. */
  readonly stops: readonly string[];
  readonly stop: Int32Array;
  /** Seconds after the start of the service day (noon minus 12 hours); past 24:00 is allowed. */
  readonly arrival: Int32Array;
  readonly departure: Int32Array;
  /** `NO_PICKUP` where `pickup_type` is 1, `NO_DROP_OFF` where `drop_off_type` is 1. */
  readonly flags: Uint8Array;
}

/** GTFS `wheelchair_boarding`: 1 accessible, 2 not; a stop left out has no information. */
export type WheelchairBoarding = 1 | 2;

export interface TimetableInput {
  readonly routes: Readonly<Record<string, GtfsRoute>>;
  readonly stops: Readonly<Record<string, GtfsStop>>;
  readonly trips: Readonly<Record<string, GtfsTrip>>;
  readonly services: Readonly<Record<string, GtfsService>>;
  readonly stopTimes: StopTimeColumns;
  readonly transfers: readonly GtfsTransfer[];
  /**
   * The shapes trips name, by `shape_id`, as encoded polylines; empty for an index stored before
   * shapes were read, and then rides are drawn through their stops.
   */
  readonly shapes: Readonly<Record<string, string>>;
  readonly wheelchairBoarding: Readonly<Record<string, WheelchairBoarding>>;
  /**
   * The complex of each station (stations joined inside fare control, as Times Sq-42 St): a
   * step-free change follows a `transfers.txt` rule only between stations of one complex. Empty
   * when the timetable says nothing, and then only rules inside one station are followed.
   */
  readonly complexes: Readonly<Record<string, string>>;
  /**
   * The step-free entrances (elevators and ramps) of each station, so step-free walks are
   * measured from them. A station without any keeps its own point, and the evidence says so.
   */
  readonly entrances: Readonly<Record<string, readonly EntrancePoint[]>>;
}

/** A step-free way into or out of a station, where it meets the street. */
export interface EntrancePoint {
  readonly lat: number;
  readonly lon: number;
  readonly entry: boolean;
  readonly exit: boolean;
}

export interface TimetableReading {
  readonly sourceId: string;
  /** The served snapshot version: the compiled network is rebuilt only when one changes. */
  readonly version: string | undefined;
  readonly provenance: Provenance;
  /** Undefined when the source has nothing usable; the provenance says why. */
  readonly timetable: TimetableInput | undefined;
}

/**
 * How a live trip id names a timetable trip. MTA bus feeds use the static id; subway feeds use
 * its part after the first underscore, sometimes without the path (`115550_1..N` for
 * `AFA26GEN-1095-Weekday-00_115550_1..N03R`).
 */
type TripIdRule = 'exact' | 'mta-subway';

export interface LiveTrip {
  readonly tripId: string;
  /** GTFS service date `YYYYMMDD` of the trip, as the feed gives it. */
  readonly startDate: string | null;
  /** The feed says the trip does not run (`schedule_relationship` CANCELED). */
  readonly cancelled: boolean;
  /** Stops still ahead with their predicted times, in travel order. */
  readonly stops: readonly PredictedStop[];
}

export interface LivePredictions {
  /** The timetable sources whose trips these predictions are about. */
  readonly timetables: readonly string[];
  readonly rule: TripIdRule;
  readonly trips: readonly LiveTrip[];
}

export interface PredictionReading {
  readonly sourceId: string;
  readonly provenance: Provenance;
  readonly predictions: LivePredictions | undefined;
}

/** The time a trip may use: it leaves no earlier than `from` and arrives by `to`. */
export interface PlanWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface EngineSources {
  /** Step-free data depends on the window: an elevator outage announced inside it counts. */
  readTimetables(window: PlanWindow, signal?: AbortSignal): Promise<readonly TimetableReading[]>;
  readPredictions(signal?: AbortSignal): Promise<readonly PredictionReading[]>;
}
