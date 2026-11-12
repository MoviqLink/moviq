import type { CitySource, LivePosition, RestroomFacts } from '@moviq/contracts';

import type { CityMode, RouteRef } from './lines.js';

/**
 * What each city tool found, as data: every figure and time comes from a source read this turn,
 * and a source that could not be read is `null` there, never an empty list. The same finding is
 * told by the fixed words, sent to the model and shown as a card. No finding holds coordinates.
 */

export interface AlertFact {
  /** As the operator publishes it, in English. */
  readonly text: string;
  readonly since: string | null;
  readonly until: string | null;
}

/** A list of alerts read from sources; `null` when none of them could be read now. */
export interface AlertList {
  readonly alerts: readonly AlertFact[] | null;
  /** True when the copy read is too old to say that nothing is in force. */
  readonly aged: boolean;
}

export interface HeldTrain {
  readonly destination: string;
  readonly leftStop: string;
  readonly elapsedSeconds: number;
  readonly usualSeconds: number;
  readonly n: number;
}

export interface LateBus {
  readonly name: string | null;
  readonly destination: string;
  readonly minutes: number;
}

export interface LineLive {
  /** Vehicles of the line followed in Explore now. */
  readonly followed: number;
  readonly late: readonly LateBus[];
  readonly held: readonly HeldTrain[];
  /** Trips the operator's feed lists as cancelled; null where the feed gives none. */
  readonly cancelled: number | null;
}

export interface VehicleFact {
  readonly line: string;
  readonly name: string | null;
  readonly destination: string;
  readonly basis: LivePosition['basis'];
  /** For a train placed by station: the station and how the train stands to it. */
  readonly station: {
    readonly name: string;
    readonly status: 'stopped' | 'arriving' | 'heading';
  } | null;
  readonly marginMeters: number | null;
  readonly dataTime: string;
  readonly next: { readonly name: string; readonly at: string | null } | null;
}

export interface OutageFact {
  readonly kind: 'elevator' | 'escalator';
  readonly serving: string;
  /** Part of the step-free path, as the MTA marks it. */
  readonly ada: boolean;
  /** Another elevator gives the same access; null when the equipment list could not be read. */
  readonly redundant: boolean | null;
  readonly since: string;
  readonly estimatedReturn: string | null;
}

export interface StationFact {
  readonly name: string;
  readonly lines: readonly string[];
  readonly ada: 'full' | 'partial' | 'none';
  readonly northbound: boolean;
  readonly southbound: boolean;
  readonly note: string | null;
  /** Null when the outages feed could not be read now. */
  readonly outagesNow: readonly OutageFact[] | null;
  readonly announced: readonly OutageFact[] | null;
}

export interface HeadwayFact {
  readonly direction: string;
  readonly n: number;
  readonly p50Seconds: number;
  readonly p90Seconds: number;
  readonly bunched: number;
}

/** A public restroom in service near a place asked, free like every one of the city's list. */
export interface RestroomFact {
  readonly name: string;
  /** The place it is nearest to, as named in the question or the trip. */
  readonly near: string;
  /** The straight line from that place, to the nearest 10 m: never a walk. */
  readonly straightMetres: number;
  /** As published, line by line; never worked out into "open now". */
  readonly hours: string | null;
  readonly season: RestroomFacts['season'];
  readonly access: RestroomFacts['access'];
  readonly keyOrCode: boolean;
}

export type Finding =
  | {
      readonly kind: 'line-status';
      readonly route: RouteRef;
      readonly alerts: AlertList;
      /** Null when the live feeds of the line could not be read. */
      readonly live: LineLive | null;
      readonly sources: readonly CitySource[];
    }
  | {
      readonly kind: 'incidents';
      readonly subject: string;
      readonly scope: 'line' | 'station' | 'mode' | 'trip';
      /** The line asked about, for the scope `line`. */
      readonly route: RouteRef | null;
      readonly mode: CityMode | null;
      readonly alerts: AlertList;
      /** Elevators and escalators out at the station asked about; null for other scopes. */
      readonly outages: readonly OutageFact[] | null;
      readonly sources: readonly CitySource[];
    }
  | {
      readonly kind: 'where-is';
      readonly subject: string;
      /** Null when the live data of that mode could not be read. */
      readonly vehicles: readonly VehicleFact[] | null;
      /** Vehicles found beyond those listed. */
      readonly more: number;
      readonly sources: readonly CitySource[];
    }
  | {
      readonly kind: 'station-access';
      readonly subject: string;
      readonly stations: readonly StationFact[];
      readonly sources: readonly CitySource[];
    }
  | {
      readonly kind: 'line-reliability';
      readonly route: RouteRef;
      /** Null until the recorder has measured enough of this line at that time. */
      readonly measured: {
        readonly day: string;
        readonly dayType: 'weekday' | 'saturday' | 'sunday';
        readonly band: 'night' | 'am-peak' | 'midday' | 'pm-peak' | 'evening';
        readonly headways: readonly HeadwayFact[];
        readonly stoppages: number;
      } | null;
      readonly sources: readonly CitySource[];
    }
  | {
      readonly kind: 'restrooms';
      readonly subject: string;
      /** Near the next stops of the trip, a subway station or a place named. */
      readonly scope: 'trip' | 'stop' | 'place';
      /** A step-free trip: the fully accessible restrooms come first. */
      readonly stepFree: boolean;
      readonly withinMetres: number;
      /** Null when the city's list could not be read now. */
      readonly restrooms: readonly RestroomFact[] | null;
      readonly sources: readonly CitySource[];
    };

/** Why a tool could not answer, said to the model and in the fixed words. */
export type Unanswered =
  | { readonly kind: 'unknown-route'; readonly said: string }
  | { readonly kind: 'unknown-station'; readonly said: string }
  | { readonly kind: 'stations-unavailable'; readonly said: string }
  | { readonly kind: 'unknown-place'; readonly said: string }
  | { readonly kind: 'places-unavailable'; readonly said: string }
  | { readonly kind: 'no-trip' };
