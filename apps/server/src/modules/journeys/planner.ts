import { randomUUID } from 'node:crypto';

import { toInstant, type Itinerary, type PlanRequest, type PlanResponse } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { SourceReader } from '../data-platform/reader.js';
import { itineraryAccessibility, walksNotStepFreeChecked } from './accessibility.js';
import { toItinerary } from './itineraries.js';
import { journeyStore } from './journey-store.js';
import type {
  FareRules,
  JourneyPlanner,
  ProviderOutcome,
  RoutedItinerary,
  RoutingProvider,
} from './ports.js';
import { readStepFreeLists } from './step-free-lists.js';

export interface PlannerDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly routing: RoutingProvider;
  readonly fares: FareRules;
  /**
   * The platform reader, for the step-free check of step-free plans: the MTA lists they were
   * planned on, read again with the outages. Without it their accessibility is null, which the
   * trip shows as not checked.
   */
  readonly reader?: SourceReader;
}

const OPTIONS_ASKED = 5;
const MINUTE = 60_000;

/**
 * Plans backwards from the time the traveller must arrive. Only itineraries the routing engine
 * returned are offered; the recommended one leaves as late as possible while keeping the spare
 * time asked for. When the engine cannot answer, the plan says so instead of guessing.
 */
export function createPlanner(deps: PlannerDependencies): JourneyPlanner {
  return {
    async plan(request, travellerId, signal) {
      const now = deps.clock.now();
      const arriveBy = new Date(request.arriveBy);
      const outcome = await deps.routing.plan(
        {
          from: request.origin,
          to: request.destination,
          arriveBy: new Date(arriveBy.getTime() - request.preferences.spareMinutes * MINUTE),
          modes: request.preferences.modes,
          maxWalkMinutes: request.preferences.maxWalkMinutes,
          stepFree: request.preferences.stepFree,
          count: OPTIONS_ASKED,
        },
        signal,
      );
      const response = outcome.ok
        ? choose(await itinerariesOf(deps, outcome, request, now), request, now)
        : {
            planId: randomUUID(),
            generatedAt: toInstant(now),
            itineraries: [],
            recommendedId: null,
            notices: [refusalNotice(outcome)],
          };
      await journeyStore.savePlan(deps.db, travellerId, request, response, now);
      return response;
    },
  };
}

type Answered = Extract<ProviderOutcome<readonly RoutedItinerary[]>, { readonly ok: true }>;

/** The itineraries served, and for a step-free plan each with its step-free check. */
async function itinerariesOf(
  deps: PlannerDependencies,
  outcome: Answered,
  request: PlanRequest,
  now: Date,
): Promise<Itinerary[]> {
  const arriveBy = new Date(request.arriveBy);
  const itineraries = outcome.value.map((routed) =>
    toItinerary(routed, outcome.provenance, arriveBy, deps.fares),
  );
  if (!request.preferences.stepFree || deps.reader === undefined) return itineraries;
  const reading = await readStepFreeLists(deps.reader);
  const window = { from: now, to: arriveBy };
  const { modes } = request.preferences;
  return itineraries.map((itinerary) => ({
    ...itinerary,
    accessibility: itineraryAccessibility(itinerary, modes, reading, window),
  }));
}

/**
 * The plain sentence of a refusal: a step-free one says what cannot be guaranteed, one whose
 * walks the streets have no way for says that no route can be walked.
 */
function refusalNotice(outcome: Extract<ProviderOutcome<unknown>, { readonly ok: false }>): string {
  if (outcome.code === 'no-step-free-data') {
    return `We can't guarantee a step-free trip right now: ${outcome.detail}`;
  }
  if (outcome.code === 'no-street-way') {
    return `No route can be walked on the streets for this trip: ${outcome.detail}`;
  }
  return `Routes are not available right now: ${outcome.detail}`;
}

/**
 * On a step-free plan, the itineraries whose walks were all walked with the wheelchair profile
 * come first, each group in its order: the others cannot be called step-free on those walks.
 */
function checkedFirst(itineraries: readonly Itinerary[], stepFree: boolean): Itinerary[] {
  if (!stepFree) return [...itineraries];
  const checked = itineraries.filter(
    (itinerary) => walksNotStepFreeChecked(itinerary).length === 0,
  );
  return [...checked, ...itineraries.filter((itinerary) => !checked.includes(itinerary))];
}

/** What the recommended itinerary cannot claim about its walks, in plain sentences. */
function walkNotices(recommended: Itinerary, stepFree: boolean): string[] {
  const notices: string[] = [];
  if (recommended.walking === 'provisional') {
    notices.push(
      'Some walks of the recommended route are estimated, not checked on the streets: ' +
        'its changes are not confirmed and its time to spare is approximate.',
    );
  }
  if (stepFree && walksNotStepFreeChecked(recommended).length > 0) {
    notices.push(
      'Step-free access is not checked on some walks of the recommended route: ' +
        'they were not walked on the streets with a wheelchair.',
    );
  }
  return notices;
}

function choose(itineraries: readonly Itinerary[], request: PlanRequest, now: Date): PlanResponse {
  const upcoming = itineraries.filter(
    (itinerary) => Date.parse(itinerary.departAt) >= now.getTime(),
  );
  const { stepFree } = request.preferences;
  const sorted = checkedFirst(
    [...upcoming].sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt)),
    stepFree,
  );
  const comfortable = sorted.filter(
    (itinerary) => itinerary.spareMinutes >= request.preferences.spareMinutes,
  );
  const earliest = checkedFirst(
    [...upcoming].sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt)),
    stepFree,
  )[0];
  const recommended = comfortable[0] ?? earliest;
  const notices: string[] = recommended === undefined ? [] : walkNotices(recommended, stepFree);
  if (upcoming.length === 0) {
    notices.push('No route leaves from now on and arrives in time.');
  } else if (comfortable.length === 0 && recommended !== undefined) {
    const at = toNewYorkWallClockText(new Date(recommended.arriveAt)).slice(11, 16);
    notices.push(
      `No option keeps ${String(request.preferences.spareMinutes)} min to spare; the earliest arrives at ${at}.`,
    );
  }
  const ordered =
    recommended === undefined
      ? sorted
      : [recommended, ...sorted.filter((itinerary) => itinerary.id !== recommended.id)];
  return {
    planId: randomUUID(),
    generatedAt: toInstant(now),
    itineraries: ordered,
    recommendedId: recommended?.id ?? null,
    notices,
  };
}
