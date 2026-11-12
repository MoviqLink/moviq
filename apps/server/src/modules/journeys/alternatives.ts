import type { Alternative, Itinerary, Journey } from '@moviq/contracts';

import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import { walksNotStepFreeChecked } from './accessibility.js';
import { toItinerary } from './itineraries.js';
import type { FareRules, RouteQuery, RoutingProvider } from './ports.js';
import { taxiFare } from './taxi-fare.js';

const MINUTE = 60_000;
const ALTERNATIVES_SHOWN = 3;

interface AlternativesFound {
  readonly alternatives: readonly Alternative[];
  /** Why the routing engine gave no ride, as `no-step-free-data`; undefined when it answered. */
  readonly refused: { readonly code: string; readonly detail: string } | undefined;
}

/**
 * Other ways to reach the destination from where the plan says the traveller will be next, the
 * earliest arrival first and recommended. Only what the routing engine returns is offered.
 */
export async function findAlternatives(
  journey: Journey,
  routing: RoutingProvider,
  fares: FareRules,
  now: Date,
  signal?: AbortSignal,
): Promise<AlternativesFound> {
  const legs = journey.itinerary.legs;
  const next = legs.find((leg) => Date.parse(leg.departAt) > now.getTime()) ?? legs.at(-1);
  if (next === undefined) return { alternatives: [], refused: undefined };
  const { preferences } = journey.request;
  const deadline = new Date(journey.request.arriveBy);
  const query: RouteQuery = {
    from: next.from,
    to: journey.request.destination,
    arriveBy: deadline,
    modes: preferences.modes,
    maxWalkMinutes: preferences.maxWalkMinutes,
    stepFree: preferences.stepFree,
    count: ALTERNATIVES_SHOWN + 2,
  };
  const [transit, taxi] = await Promise.all([
    routing.plan(query, signal),
    routing.plan({ ...query, modes: ['taxi'], count: 1 }, signal),
  ]);
  const options: Alternative[] = transit.ok
    ? transit.value
        .map((routed) => toItinerary(routed, transit.provenance, deadline, fares))
        .filter((itinerary) => Date.parse(itinerary.departAt) >= now.getTime())
        .map((itinerary) => ({
          id: itinerary.id,
          itinerary,
          recommended: false,
          why: '',
          price: null,
        }))
    : [];
  const taxiOption = taxi.ok
    ? taxiAlternative(
        taxi.value.map((routed) => toItinerary(routed, taxi.provenance, deadline, fares))[0],
        journey,
        now,
      )
    : undefined;
  const byArrival = [...options, ...(taxiOption === undefined ? [] : [taxiOption])].sort(
    (a, b) => Date.parse(a.itinerary.arriveAt) - Date.parse(b.itinerary.arriveAt),
  );
  const alternatives = checkedFirst(byArrival, preferences.stepFree)
    .slice(0, ALTERNATIVES_SHOWN)
    .map((option, index) => ({
      ...option,
      recommended: index === 0,
      why:
        why(
          Date.parse(option.itinerary.arriveAt),
          deadline.getTime(),
          index === 0,
          option.price !== null,
        ) + walksSaid(option.itinerary, preferences.stepFree),
    }));
  const refused = transit.ok ? undefined : { code: transit.code, detail: transit.detail };
  return { alternatives, refused };
}

/** A taxi of the demo partner, priced upfront at the official rates; none without a verified price. */
function taxiAlternative(
  itinerary: Itinerary | undefined,
  journey: Journey,
  now: Date,
): Alternative | undefined {
  const ride = itinerary?.legs.find((leg) => leg.mode === 'taxi');
  if (
    itinerary === undefined ||
    ride === undefined ||
    Date.parse(itinerary.departAt) < now.getTime()
  )
    return undefined;
  const airport = journey.request.flight?.airport ?? null;
  const fare = taxiFare({
    path: ride.path,
    durationSeconds: (Date.parse(ride.arriveAt) - Date.parse(ride.departAt)) / 1000,
    startsAt: new Date(ride.departAt),
    airport,
  });
  if (fare === null) return undefined;
  return {
    id: itinerary.id,
    itinerary: { ...itinerary, fare },
    recommended: false,
    why: '',
    price: fare.amount,
  };
}

/** On a step-free trip, options whose walks were walked with a wheelchair come first. */
function checkedFirst(options: readonly Alternative[], stepFree: boolean): Alternative[] {
  if (!stepFree) return [...options];
  const checked = options.filter(
    (option) => walksNotStepFreeChecked(option.itinerary).length === 0,
  );
  return [...checked, ...options.filter((option) => !checked.includes(option))];
}

/** What an option cannot claim about its walks: estimated ones, or not checked step-free. */
function walksSaid(itinerary: Itinerary, stepFree: boolean): string {
  const estimated =
    itinerary.walking === 'provisional'
      ? ' Some of its walks are estimated: changes not confirmed, time to spare approximate.'
      : '';
  const access =
    stepFree && walksNotStepFreeChecked(itinerary).length > 0
      ? ' Step-free access is not checked on some of its walks.'
      : '';
  return estimated + access;
}

function why(arrival: number, deadline: number, first: boolean, paid: boolean): string {
  const at = toNewYorkWallClockText(new Date(arrival)).slice(11, 16);
  const spare = Math.floor((deadline - arrival) / MINUTE);
  const timing = spare >= 0 ? `${String(spare)} min to spare` : `${String(-spare)} min late`;
  const what = paid ? 'A taxi of our demo partner, paid with PayPal: arrives' : 'Arrives';
  return `${what} at ${at}, ${timing}${first ? ': the earliest option' : ''}.`;
}
