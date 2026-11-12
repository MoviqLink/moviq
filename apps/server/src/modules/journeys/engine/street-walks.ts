/**
 * The street network the engine asks to walk its final itineraries on: Transitous (MOTIS 2 over
 * OpenStreetMap) on the platform. The engine searches with straight-line estimates and only asks
 * the streets about the walks of the itineraries it is about to return.
 */
export type WalkProfile = 'foot' | 'wheelchair';

export interface StreetPoint {
  readonly lat: number;
  readonly lon: number;
}

export interface StreetWalkAsk {
  readonly from: StreetPoint;
  readonly to: StreetPoint;
}

/**
 * One walk as the streets answer it: `walked`, with its seconds, metres and path; the streets
 * have no way between the two points (`no-street-route`); no answer (`streets-unavailable`); or
 * not asked, since the plan's share of requests was spent (`not-asked`).
 */
export type StreetWalkAnswer =
  | {
      readonly kind: 'walked';
      readonly seconds: number;
      readonly metres: number;
      /** [longitude, latitude] pairs. */
      readonly path: readonly (readonly [number, number])[];
    }
  | { readonly kind: 'no-street-route' }
  | { readonly kind: 'streets-unavailable' }
  | { readonly kind: 'not-asked' };

interface StreetWalksAnswer {
  /** One answer per walk asked, in the same order. */
  readonly answers: readonly StreetWalkAnswer[];
  /** Requests sent to the network; answers kept from earlier plans send none. */
  readonly requests: number;
}

export interface StreetWalks {
  readonly sourceId: string;
  /** Walks with one profile, sending at most `maxRequests` requests; the rest are `not-asked`. */
  walk(
    asks: readonly StreetWalkAsk[],
    profile: WalkProfile,
    maxRequests: number,
    signal?: AbortSignal,
  ): Promise<StreetWalksAnswer>;
}
