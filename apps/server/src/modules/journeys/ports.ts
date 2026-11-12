import type {
  Flight,
  Leg,
  Money,
  Place,
  PlanRequest,
  PlanResponse,
  Provenance,
  TravelMode,
} from '@moviq/contracts';

/**
 * What journeys need from the outside world, behind interfaces: a routing engine, a geocoder,
 * a flight finder and the public fare rules. Each adapter validates what it receives and says
 * plainly when it cannot answer; nothing here invents a time, a place or a price.
 */

/** The answer of an on-demand provider: a value with its provenance, or why there is none. */
export type ProviderOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly provenance: Provenance }
  | {
      readonly ok: false;
      readonly state: 'unavailable' | 'misconfigured' | 'rate_limited';
      readonly code: string;
      /** One plain sentence, safe to show to operators. */
      readonly detail: string;
    };

export interface RouteQuery {
  readonly from: Place;
  readonly to: Place;
  /** Itineraries must arrive no later than this. */
  readonly arriveBy: Date;
  readonly modes: readonly TravelMode[];
  readonly maxWalkMinutes: number;
  readonly stepFree: boolean;
  readonly count: number;
}

/** One leg as the routing engine returns it, before MovIQ checks it against live data. */
export interface RoutedLeg {
  readonly mode: TravelMode;
  readonly from: Place;
  readonly to: Place;
  readonly departAt: Date;
  readonly arriveAt: Date;
  readonly route: {
    readonly id: string;
    readonly shortName: string;
    readonly headsign: string | null;
  } | null;
  /** The GTFS trip id as the engine knows it, to match live predictions. */
  readonly tripId: string | null;
  /** True when the engine used a timetable; false when it already used a live prediction. */
  readonly scheduled: boolean;
  /** [longitude, latitude] pairs. */
  readonly path: readonly (readonly [number, number])[];
  /** How a walk is known (`legSchema`'s `walk`); absent for the other modes. */
  readonly walk?: RoutedWalk;
}

export type RoutedWalk = NonNullable<Leg['walk']>;

export interface RoutedItinerary {
  readonly legs: readonly RoutedLeg[];
}

export interface RoutingProvider {
  readonly sourceId: string;
  plan(
    query: RouteQuery,
    signal?: AbortSignal,
  ): Promise<ProviderOutcome<readonly RoutedItinerary[]>>;
}

export interface Geocoder {
  readonly sourceId: string;
  /** Places in New York matching free text, best first. */
  search(text: string, signal?: AbortSignal): Promise<ProviderOutcome<readonly Place[]>>;
}

export interface FlightQuery {
  /** IATA or ICAO carrier code, upper case. */
  readonly carrier: string;
  readonly number: string;
  /** Local departure date in New York, `YYYY-MM-DD`. */
  readonly date: string;
}

export interface FlightFinder {
  readonly sourceId: string;
  /** The flight departing a New York airport, or null when there is no such flight. */
  find(query: FlightQuery, signal?: AbortSignal): Promise<ProviderOutcome<Flight | null>>;
}

export interface FareQuote {
  readonly amount: Money;
  /** How the fare applies, such as the free transfer within two hours. */
  readonly note: string;
}

export interface FareRules {
  /** The public fare of an itinerary's legs, or null when MovIQ has no verified rule for them. */
  fareFor(legs: readonly RoutedLeg[]): FareQuote | null;
}

/** Plans a trip and keeps the itineraries, so a journey is created from the plan id alone. */
export interface JourneyPlanner {
  plan(request: PlanRequest, travellerId: string, signal?: AbortSignal): Promise<PlanResponse>;
}
