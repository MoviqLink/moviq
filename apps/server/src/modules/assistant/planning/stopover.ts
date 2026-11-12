import {
  toInstant,
  type Itinerary,
  type Place,
  type PlanRequest,
  type PlanResponse,
} from '@moviq/contracts';
import { z } from 'zod';

import type { PlanningPorts } from './actions.js';
import type { Turn } from './state.js';
import { defineTool, type AssistantTool } from './tool.js';

/** The time a stop on the way takes: long enough for a coffee, short enough to keep the plan. */
export const STOP_MINUTES = 10;

function recommended(plan: PlanResponse): Itinerary | undefined {
  return plan.itineraries.find((itinerary) => itinerary.id === plan.recommendedId);
}

/**
 * A trip through a stop on the way, planned backwards like every other: first from the stop to
 * the destination by the time to be there, then from the start to the stop, early enough to
 * spend `STOP_MINUTES` in it. Both parts are the planner's own; the trip joins their legs and
 * states no fare, since leaving the system at the stop is paid again. When either part has no
 * itinerary, that part's answer is returned as it is, with its notices.
 */
export async function planThroughStop(
  ports: PlanningPorts,
  turn: Turn,
  request: PlanRequest,
  stop: Place,
): Promise<PlanResponse> {
  const onward = await ports.planner.plan(
    { ...request, origin: stop },
    turn.travellerId,
    turn.signal,
  );
  const second = recommended(onward);
  if (second === undefined) return onward;
  const atStop = new Date(new Date(second.departAt).getTime() - STOP_MINUTES * 60_000);
  const before = await ports.planner.plan(
    { ...request, destination: stop, arriveBy: toInstant(atStop), flight: null },
    turn.travellerId,
    turn.signal,
  );
  const first = recommended(before);
  if (first === undefined) return before;
  const joined: Itinerary = {
    ...second,
    departAt: first.departAt,
    transfers: first.transfers + second.transfers,
    walkMinutes: first.walkMinutes + second.walkMinutes,
    legs: [...first.legs, ...second.legs],
    fare: null,
  };
  return {
    ...onward,
    itineraries: [joined],
    recommendedId: joined.id,
    notices: [...new Set([...before.notices, ...onward.notices])],
  };
}

/**
 * Where a trip through `stop` passes it: the index of the first leg that leaves the stop, so the
 * legs before it and from it are priced as two rides. Undefined when the trip has no such leg.
 */
export function legAfterStop(legs: Itinerary['legs'], stop: Place): number | undefined {
  const index = legs.findIndex(
    (leg, position) =>
      position > 0 && leg.from.label === stop.label && legs[position - 1]?.to.label === stop.label,
  );
  return index === -1 ? undefined : index;
}

/** Sara adds a stop on the way when asked for a detour, and the trip is planned through it. */
export const stopTools: readonly AssistantTool[] = [
  defineTool(
    'add_stop',
    'Adds a stop on the way of the trip (a detour): a place to pass by before the destination, ' +
      'such as a café, a shop or a square. The trip is planned again through it, with ten ' +
      'minutes there. Use it when the traveller asks for a detour or a stop on the way; query ' +
      'is the place as they said it.',
    z.strictObject({ query: z.string().trim().min(2).max(120) }),
    async (input, ports, turn) => {
      const outcome = await ports.geocoder.search(input.query, turn.signal);
      if (!outcome.ok) {
        return outcome.code === 'no-match'
          ? { found: 'nothing', query: input.query }
          : { error: 'Address search is not available right now.' };
      }
      const [place] = outcome.value;
      if (place === undefined) return { found: 'nothing', query: input.query };
      turn.state.stop = place;
      turn.state.plan = null;
      return { stop: place.label, minutesThere: STOP_MINUTES };
    },
  ),
];
