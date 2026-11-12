import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import type {
  StreetPoint,
  StreetWalkAnswer,
  StreetWalkAsk,
  StreetWalks,
  WalkProfile,
} from '../../journeys/engine/street-walks.js';
import type { DailyBudget } from './daily-budget.js';
import { askWalk } from './transitous-walk.js';

/**
 * Points are asked rounded to 4 decimals (at most 6 m off in New York), so walks between the same
 * corners share one answer.
 */
const DECIMALS = 4;

/** Streets change slowly: an answer, a walk or no way, is kept 12 hours. */
const KEEP_MS = 12 * 60 * 60 * 1000;

/** The most answers kept; the oldest go first. */
const MAX_KEPT = 5000;

/** After a failure Transitous is left alone for 2 minutes, and walks stay estimated. */
const PAUSE_MS = 2 * 60 * 1000;

/** At most this many walks asked at once. */
const PARALLEL = 4;

/**
 * Walks spend the process' Transitous requests of the day only while this many are left, so
 * trips the engine cannot plan still reach Transitous.
 */
export const KEPT_FOR_PLANS = 100;

interface StreetsOptions {
  readonly http: HttpClient;
  readonly clock: Clock;
  /** The process' Transitous requests of the day, shared with its plans. */
  readonly budget: DailyBudget;
}

interface Kept {
  readonly answer: StreetWalkAnswer;
  readonly until: number;
}

function rounded(point: StreetPoint): StreetPoint {
  return { lat: Number(point.lat.toFixed(DECIMALS)), lon: Number(point.lon.toFixed(DECIMALS)) };
}

function keyOf(ask: StreetWalkAsk, profile: WalkProfile): string {
  return `${profile}:${String(ask.from.lat)},${String(ask.from.lon)}>${String(ask.to.lat)},${String(ask.to.lon)}`;
}

/** Runs the tasks with at most `PARALLEL` at a time, each answer in its place. */
async function inParallel<T>(tasks: readonly (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      if (task !== undefined) results[index] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, tasks.length) }, worker));
  return results;
}

/**
 * Walks on the OpenStreetMap streets through Transitous, light on a community service: answers
 * kept by rounded points and profile for 12 hours, at most four requests at once and the plan's
 * share each time, within the process' requests of the day, and none for 2 minutes after a
 * failure. A walk not asked or not answered is `not-asked` or `streets-unavailable`.
 */
export function createTransitousStreets(options: StreetsOptions): StreetWalks {
  const kept = new Map<string, Kept>();
  let pausedUntil = 0;
  const keep = (key: string, answer: StreetWalkAnswer, now: number): void => {
    if (answer.kind !== 'walked' && answer.kind !== 'no-street-route') return;
    kept.delete(key);
    kept.set(key, { answer, until: now + KEEP_MS });
    const oldest = kept.keys().next();
    if (kept.size > MAX_KEPT && oldest.done !== true) kept.delete(oldest.value);
  };
  return {
    sourceId: 'transitous',
    async walk(asks, profile, maxRequests, signal) {
      const now = options.clock.now();
      let allowed = 0;
      let sent = 0;
      const tasks = asks.map((ask) => {
        const exact = { from: rounded(ask.from), to: rounded(ask.to) };
        const key = keyOf(exact, profile);
        const known = kept.get(key);
        if (known !== undefined && known.until > now.getTime()) {
          return () => Promise.resolve(known.answer);
        }
        const asked =
          allowed < maxRequests &&
          now.getTime() >= pausedUntil &&
          options.budget.left(now) > KEPT_FOR_PLANS &&
          options.budget.take(now);
        if (!asked) return () => Promise.resolve<StreetWalkAnswer>({ kind: 'not-asked' });
        allowed += 1;
        return async (): Promise<StreetWalkAnswer> => {
          // A failure meanwhile pauses the walks still waiting their turn.
          if (options.clock.now().getTime() < pausedUntil) return { kind: 'streets-unavailable' };
          sent += 1;
          const answer = await askWalk(options.http, exact, profile, signal);
          const at = options.clock.now().getTime();
          if (answer.kind === 'streets-unavailable' && signal?.aborted !== true) {
            pausedUntil = at + PAUSE_MS;
          }
          keep(key, answer, at);
          return answer;
        };
      });
      return { answers: await inParallel(tasks), requests: sent };
    },
  };
}
