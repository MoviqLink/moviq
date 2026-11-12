import type { RoutedItinerary, RoutedLeg, RouteQuery } from '../ports.js';
import { rankItineraries } from './search.js';
import { retimed } from './street-retime.js';
import type { StreetWalkAnswer, StreetWalkAsk, StreetWalks, WalkProfile } from './street-walks.js';
import {
  NO_STREET_WAY,
  type EngineItinerary,
  type KnownWalks,
  type WalkRef,
  type WalkRole,
} from './walk-legs.js';

/**
 * Requests to the streets per plan, both searches together: five itineraries share most of
 * their walks (the same origin, the same stations), so eight cover them on the captures, and
 * a walk asked before in the process costs none.
 */
const STREET_REQUESTS_PER_PLAN = 8;

interface StreetCheck {
  readonly streets: StreetWalks | undefined;
  readonly query: RouteQuery;
  readonly now: Date;
  /** Stops in the network, to key the changes as the footpaths do. */
  readonly stops: number;
  readonly signal?: AbortSignal | undefined;
}

interface CheckedPlan {
  readonly itineraries: readonly RoutedItinerary[];
  /** The walks of the plan in one clause of the evidence. */
  readonly evidence: string;
  /** The walks the streets have no way for, which left their itineraries out; null if none. */
  readonly noWay: string | null;
}

const keyOf = (ask: StreetWalkAsk): string =>
  `${String(ask.from.lat)},${String(ask.from.lon)}>${String(ask.to.lat)},${String(ask.to.lon)}`;

interface Round {
  readonly kept: RoutedItinerary[];
  readonly broken: number;
}

/** The answers of one plan by walk, asked once each, within the plan's share of requests. */
class PlanWalks {
  readonly answers = new Map<string, StreetWalkAnswer>();
  /** The walks the streets have no way for, by points, with where they sit. */
  readonly noWay = new Map<string, WalkRole>();
  requests = 0;
  private readonly check: StreetCheck & { readonly streets: StreetWalks };
  private readonly profile: WalkProfile;

  constructor(check: StreetCheck & { readonly streets: StreetWalks }, profile: WalkProfile) {
    this.check = check;
    this.profile = profile;
  }

  async ask(itineraries: readonly EngineItinerary[]): Promise<void> {
    const asks = new Map<string, StreetWalkAsk>();
    for (const ref of itineraries.flatMap((itinerary) => itinerary.walks)) {
      const key = keyOf(ref);
      if (!this.answers.has(key)) asks.set(key, ref);
    }
    if (asks.size === 0) return;
    const left = STREET_REQUESTS_PER_PLAN - this.requests;
    const { streets, signal } = this.check;
    const asked = await streets.walk([...asks.values()], this.profile, left, signal);
    this.requests += asked.requests;
    for (const [index, key] of [...asks.keys()].entries()) {
      this.answers.set(key, asked.answers[index] ?? { kind: 'not-asked' });
    }
  }

  answerOf(ref: WalkRef): StreetWalkAnswer {
    return this.answers.get(keyOf(ref)) ?? { kind: 'not-asked' };
  }

  /** The street times walked so far, and the walks with no way, for a search again. */
  known(itineraries: readonly EngineItinerary[]): KnownWalks {
    const access = new Map<number, number>();
    const egress = new Map<number, number>();
    const transfers = new Map<number, number>();
    let direct: number | undefined;
    for (const ref of itineraries.flatMap((itinerary) => itinerary.walks)) {
      const answer = this.answerOf(ref);
      const seconds = answer.kind === 'walked' ? answer.seconds : NO_STREET_WAY;
      if (answer.kind !== 'walked' && answer.kind !== 'no-street-route') continue;
      if (ref.role === 'access') access.set(ref.toStop, seconds);
      else if (ref.role === 'egress') egress.set(ref.fromStop, seconds);
      else if (ref.role === 'transfer')
        transfers.set(ref.fromStop * this.check.stops + ref.toStop, seconds);
      else direct = seconds;
    }
    return { access, egress, transfers, direct };
  }

  retime(itineraries: readonly EngineItinerary[]): Round {
    const { query, now } = this.check;
    const limits = { now, arriveBy: query.arriveBy, maxWalkSeconds: query.maxWalkMinutes * 60 };
    const kept: RoutedItinerary[] = [];
    for (const itinerary of itineraries) {
      const answers = new Map(itinerary.walks.map((ref) => [ref.leg, this.answerOf(ref)]));
      for (const ref of itinerary.walks) {
        if (answers.get(ref.leg)?.kind === 'no-street-route') this.noWay.set(keyOf(ref), ref.role);
      }
      const done = retimed(itinerary, answers, limits);
      if (done !== undefined) kept.push(done);
    }
    return { kept, broken: itineraries.length - kept.length };
  }
}

/** Every walk still estimated: no street network to ask. */
function unchecked(itineraries: readonly EngineItinerary[]): RoutedItinerary[] {
  return itineraries.map((itinerary) => ({
    legs: itinerary.legs.map((leg): RoutedLeg => {
      if (leg.walk?.basis !== 'estimated') return leg;
      return { ...leg, walk: { ...leg.walk, unchecked: 'streets-unavailable' } };
    }),
  }));
}

const counted = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`;

/** The walks with no way, by where they sit: "from the start to 2 stops, for 1 change". */
function noWayClause(sourceId: string, roles: readonly WalkRole[]): string | null {
  if (roles.length === 0) return null;
  const count = (role: WalkRole): number => roles.filter((each) => each === role).length;
  const parts = [
    count('access') > 0 ? `from the start to ${counted(count('access'), 'stop')}` : '',
    count('transfer') > 0 ? `for ${counted(count('transfer'), 'change')}` : '',
    count('egress') > 0 ? `from ${counted(count('egress'), 'stop')} to the destination` : '',
    count('direct') > 0 ? 'door to door' : '',
  ].filter((part) => part !== '');
  return `the streets of ${sourceId} have no way on foot ${parts.join(', ')}`;
}

interface WalkSource {
  readonly id: string;
  readonly requests: number;
  readonly leftOut: number;
  readonly noWay: string | null;
}

function walksClause(itineraries: readonly RoutedItinerary[], source: WalkSource): string {
  const walks = itineraries.flatMap((itinerary) => itinerary.legs.flatMap((leg) => leg.walk ?? []));
  const count = (basis: string) => walks.filter((walk) => walk.basis === basis).length;
  const reasons = [...new Set(walks.flatMap((walk) => walk.unchecked ?? []))].join(', ');
  const estimated = count('estimated');
  return (
    `; walks: ${String(count('street'))} on the streets of ${source.id} ` +
    `(${String(source.requests)} requests), ${String(count('station-rule'))} by station rules, ` +
    `${String(estimated)} estimated${estimated === 0 ? '' : ` (${reasons})`}` +
    (source.leftOut === 0 ? '' : `; ${String(source.leftOut)} itineraries left out once walked`) +
    (source.noWay === null ? '' : ` (${source.noWay})`)
  );
}

/**
 * The plan with its walks walked on the streets: the engine's itineraries are retimed with the
 * street answers; when one breaks, or the streets have no way for one of its walks, the engine
 * searches again with the street times known and without the walks that have no way, and the
 * walks it finds new are asked too. What still breaks is left out; what is not answered or not
 * asked stays estimated and says why.
 */
export async function checkedPlan(
  plan: (known?: KnownWalks) => readonly EngineItinerary[],
  check: StreetCheck,
): Promise<CheckedPlan> {
  const first = plan();
  const { streets, query } = check;
  if (streets === undefined) {
    const itineraries = unchecked(first);
    return {
      itineraries,
      evidence: walksClause(itineraries, { id: 'none', requests: 0, leftOut: 0, noWay: null }),
      noWay: null,
    };
  }
  const walks = new PlanWalks({ ...check, streets }, query.stepFree ? 'wheelchair' : 'foot');
  await walks.ask(first);
  const one = walks.retime(first);
  let kept = one.kept;
  let leftOut = one.broken;
  if (one.broken > 0) {
    const second = plan(walks.known(first));
    await walks.ask(second);
    const two = walks.retime(second);
    kept = [...one.kept, ...two.kept];
    leftOut = one.broken + two.broken;
  }
  const itineraries = rankItineraries(kept, query.count);
  const noWay = noWayClause(streets.sourceId, [...walks.noWay.values()]);
  const source = { id: streets.sourceId, requests: walks.requests, leftOut, noWay };
  return { itineraries, evidence: walksClause(itineraries, source), noWay };
}
