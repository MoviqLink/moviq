import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import type {
  ProviderOutcome,
  RoutedItinerary,
  RouteQuery,
  RoutingProvider,
} from '../../journeys/ports.js';
import { createDailyBudget, type DailyBudget } from './daily-budget.js';
import {
  failure,
  failureFromHttp,
  providerProvenance,
  readJson,
  responseTime,
  unexpectedShape,
} from './outcome.js';
import { planUrl } from './transitous-request.js';
import { normalisePlan, planResponseSchema, type LeftOut } from './transitous-response.js';

const PROVIDER = 'Transitous';

/**
 * What the web shows wherever a Transitous itinerary appears, as Transitous asks
 * (https://transitous.org/api/, read on 11/11/2026): a link to its sources, and the OpenStreetMap
 * attribution its street routing requires.
 */
export const TRANSITOUS_ATTRIBUTION = {
  text: 'Routing by Transitous, map data © OpenStreetMap contributors',
  links: [
    { label: 'Transitous', url: 'https://transitous.org/sources/' },
    { label: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  ],
} as const;

/**
 * Transitous asks to coordinate above 720 requests of `/plan` in 24 hours. With the API and the
 * worker each keeping its own count, 300 a day per process, plans and walks together
 * (`transitous-streets.ts`), stays below that.
 */
export const TRANSITOUS_DAILY_REQUESTS = 300;

const LIMITS = { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 } as const;

interface TransitousOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly dailyPlans?: number;
  /** The process' Transitous requests of the day, shared with the walks; else its own count. */
  readonly budget?: DailyBudget;
}

/**
 * Public transport itineraries from Transitous, a community MOTIS 2 instance fed with the official
 * GTFS of New York (subway, MTA buses, LIRR, Metro-North, PATH and ferries).
 */
export function createTransitousRouting(options: TransitousOptions): RoutingProvider {
  const budget =
    options.budget ?? createDailyBudget(options.dailyPlans ?? TRANSITOUS_DAILY_REQUESTS);
  return {
    sourceId: 'transitous',
    async plan(query, signal) {
      if (!budget.take(options.clock.now())) {
        return failure(
          'rate_limited',
          'daily-budget',
          'The daily number of plans MovIQ asks Transitous for is spent; it resets at 00:00 UTC.',
        );
      }
      try {
        const response = await options.http.get({
          url: planUrl(query),
          headers: { accept: 'application/json' },
          ...LIMITS,
          signal,
        });
        return readPlan(response, query, options.clock.now());
      } catch (error) {
        return failureFromHttp(error, PROVIDER);
      }
    },
  };
}

function readPlan(
  response: { readonly body: Uint8Array; readonly headers: Headers },
  query: RouteQuery,
  receivedAt: Date,
): ProviderOutcome<readonly RoutedItinerary[]> {
  const json = readJson(response.body, PROVIDER);
  if (!json.ok) return json;
  const parsed = planResponseSchema.safeParse(json.value);
  if (!parsed.success) return unexpectedShape(parsed.error, PROVIDER);
  const plan = normalisePlan(parsed.data, query);
  if (!plan.ok) {
    return failure('misconfigured', 'unexpected-shape', `${PROVIDER}: ${plan.detail}.`);
  }
  const deadline = query.arriveBy.toISOString();
  if (plan.itineraries.length === 0) {
    return failure(
      'unavailable',
      'no-itineraries',
      `${PROVIDER} found no itinerary arriving by ${deadline}${leftOutNote(plan.leftOut)}.`,
    );
  }
  const engine = response.headers.get('server');
  const evidence =
    `${PROVIDER}${engine === null ? '' : ` (${engine})`} planned ` +
    `${String(plan.itineraries.length)} itineraries arriving by ${deadline}` +
    `${leftOutNote(plan.leftOut)}.`;
  return {
    ok: true,
    value: plan.itineraries,
    provenance: providerProvenance({
      sourceId: 'transitous',
      dataTime: responseTime(response.headers),
      receivedAt,
      evidence,
    }),
  };
}

const LEFT_OUT_REASONS: Readonly<Record<LeftOut, string>> = {
  'unsupported-mode': 'a mode MovIQ does not follow',
  'unusable-place': 'a place outside the New York area',
  'after-deadline': 'arriving too late',
  'bad-times': 'a leg ending before it starts',
};

function leftOutNote(leftOut: ReadonlyMap<LeftOut, number>): string {
  if (leftOut.size === 0) return '';
  const parts = [...leftOut].map(
    ([reason, count]) => `${String(count)} with ${LEFT_OUT_REASONS[reason]}`,
  );
  return `; left out: ${parts.join(', ')}`;
}
