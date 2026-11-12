import type { RoutedItinerary, RoutedLeg } from '../ports.js';
import type { StreetWalkAnswer } from './street-walks.js';
import type { EngineItinerary, WalkRole } from './walk-legs.js';
import { SAME_STOP_CHANGE_SECONDS } from './walking.js';

/** What an itinerary must still keep once its walks take their street times. */
interface RetimeLimits {
  readonly now: Date;
  readonly arriveBy: Date;
  readonly maxWalkSeconds: number;
}

/** An answer that leaves the walk in the itinerary: walked, or not answered and still estimated. */
type Answered = Exclude<StreetWalkAnswer, { readonly kind: 'no-street-route' }>;

const NOT_ASKED: Answered = { kind: 'not-asked' };

/**
 * The walk's times at its street duration. A walk to the first ride, or a trip on foot only, still
 * ends when it did, so it leaves earlier or later; a change or a walk to the destination starts
 * when the ride ends and finishes later or sooner. A change takes at least the time to change.
 */
function timed(
  leg: RoutedLeg,
  role: WalkRole,
  seconds: number,
): Pick<RoutedLeg, 'departAt' | 'arriveAt'> {
  if (role === 'access' || role === 'direct') {
    return { departAt: new Date(leg.arriveAt.getTime() - seconds * 1000), arriveAt: leg.arriveAt };
  }
  const span = role === 'transfer' ? Math.max(SAME_STOP_CHANGE_SECONDS, seconds) : seconds;
  return { departAt: leg.departAt, arriveAt: new Date(leg.departAt.getTime() + span * 1000) };
}

/** A walk leg as the streets answered: walked, with its path and metres, or still estimated. */
function answered(leg: RoutedLeg, role: WalkRole, answer: Answered): RoutedLeg {
  const profile = leg.walk?.profile ?? 'foot';
  if (answer.kind !== 'walked') {
    return {
      ...leg,
      walk: { basis: 'estimated', profile, metres: null, unchecked: answer.kind },
    };
  }
  return {
    ...leg,
    ...timed(leg, role, answer.seconds),
    path: answer.path,
    walk: { basis: 'street', profile, metres: Math.round(answer.metres), unchecked: null },
  };
}

/** Every leg starts once the one before ends, inside now and the deadline and the walk limit. */
function fits(
  legs: readonly RoutedLeg[],
  ends: readonly { readonly leg: number; readonly role: WalkRole }[],
  limits: RetimeLimits,
): boolean {
  const first = legs[0];
  const last = legs.at(-1);
  if (first === undefined || last === undefined) return false;
  if (first.departAt < limits.now || last.arriveAt > limits.arriveBy) return false;
  const inOrder = legs.every(
    (leg, index) => index === 0 || (legs[index - 1]?.arriveAt ?? leg.departAt) <= leg.departAt,
  );
  const withinLimit = ends.every(({ leg, role }) => {
    const walk = legs[leg];
    if (walk === undefined || role === 'transfer') return true;
    return walk.arriveAt.getTime() - walk.departAt.getTime() <= limits.maxWalkSeconds * 1000;
  });
  return inOrder && withinLimit;
}

/**
 * The itinerary with each walk the streets walked at its street time, path and metres, and the
 * others labelled estimated with why (not answered, or not asked); undefined when the streets
 * have no way for one of its walks, or when the street times break it: a change that no longer
 * makes the next ride, a start before now, an arrival after the deadline or a walk past the
 * limit. It is then left out, never shown broken nor provisional.
 */
export function retimed(
  itinerary: EngineItinerary,
  answers: ReadonlyMap<number, StreetWalkAnswer>,
  limits: RetimeLimits,
): RoutedItinerary | undefined {
  const legs = [...itinerary.legs];
  for (const ref of itinerary.walks) {
    const leg = legs[ref.leg];
    const answer = answers.get(ref.leg) ?? NOT_ASKED;
    if (leg === undefined || answer.kind === 'no-street-route') return undefined;
    legs[ref.leg] = answered(leg, ref.role, answer);
  }
  return fits(legs, itinerary.walks, limits) ? { legs } : undefined;
}
