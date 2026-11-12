import type { Alternative, Itinerary, PlanResponse } from '@moviq/contracts';

/** The recommended item first; the rest keep the order the server chose. */
function recommendedFirst<T>(items: readonly T[], isRecommended: (item: T) => boolean): T[] {
  return [...items.filter(isRecommended), ...items.filter((item) => !isRecommended(item))];
}

/** The plan's itineraries with the recommended one first. */
export function orderItineraries(plan: PlanResponse): Itinerary[] {
  return recommendedFirst(plan.itineraries, (itinerary) => itinerary.id === plan.recommendedId);
}

/** A journey's alternatives with the recommended one first. */
export function orderAlternatives(alternatives: readonly Alternative[]): Alternative[] {
  return recommendedFirst(alternatives, (alternative) => alternative.recommended);
}
