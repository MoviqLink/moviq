import type { Itinerary, Leg } from '@moviq/contracts';

/** How a walk is known; a leg kept before walks were labelled is estimated, never a way walked. */
type WalkBasis = NonNullable<Leg['walk']>['basis'];

export function walkBasis(leg: Leg): WalkBasis {
  return leg.walk?.basis ?? 'estimated';
}

/** A walk between two rides: a change, which an estimate cannot confirm. */
function isChange(legs: readonly Leg[], index: number): boolean {
  const before = legs[index - 1];
  const after = legs[index + 1];
  const ride = (leg: Leg | undefined) => leg !== undefined && leg.mode !== 'walk';
  return legs[index]?.mode === 'walk' && ride(before) && ride(after);
}

/** What a walk's row says: walked, a station's time, estimated, or a change not checked. */
export function walkNote(legs: readonly Leg[], index: number): WalkBasis | 'change' | null {
  const leg = legs[index];
  if (leg?.mode !== 'walk') return null;
  const basis = walkBasis(leg);
  return basis === 'estimated' && isChange(legs, index) ? 'change' : basis;
}

/** An itinerary with an estimated walk is provisional: its changes and spare time are not sure. */
export function isProvisional(itinerary: Pick<Itinerary, 'legs' | 'walking'>): boolean {
  if (itinerary.walking !== undefined) return itinerary.walking === 'provisional';
  return itinerary.legs.some((leg) => leg.mode === 'walk' && walkBasis(leg) === 'estimated');
}
