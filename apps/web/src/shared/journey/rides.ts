import type { Itinerary, TravelMode } from '@moviq/contracts';

import type { JourneyDict } from './texts';

export interface Ride {
  readonly mode: TravelMode;
  /** The route as the operator names it, in MovIQ's own style, or the mode when it has none. */
  readonly name: string;
}

/** What an itinerary rides, in order; a trip made only on foot is one walk. */
export function ridesOf(itinerary: Itinerary, t: JourneyDict): Ride[] {
  const rides = itinerary.legs.filter((leg) => leg.mode !== 'walk');
  if (rides.length === 0) return [{ mode: 'walk', name: t.modes.walk }];
  return rides.map((leg) => ({ mode: leg.mode, name: leg.route?.shortName ?? t.modes[leg.mode] }));
}

/** The rides as one line: `Bus M60-SBS → Subway N`, `Taxi`. */
export function ridesLine(itinerary: Itinerary, t: JourneyDict): string {
  return ridesOf(itinerary, t)
    .map((ride) =>
      ride.name === t.modes[ride.mode] ? ride.name : `${t.modes[ride.mode]} ${ride.name}`,
    )
    .join(' → ');
}
