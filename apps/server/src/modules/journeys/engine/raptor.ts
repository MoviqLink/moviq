import {
  createRun,
  round,
  takeImproved,
  usable,
  type FrontEntry,
  type Labels,
  type Run,
  type SearchRequest,
} from './labels.js';
import { NONE } from './live.js';
import { scanRound } from './scan.js';

/**
 * RAPTOR run backwards (Delling, Pajor and Werneck, "Round-Based Public Transit Routing",
 * Transportation Science 49(3), 2015, section 3 and its reverse search for "arrive by"). Round
 * `k` finds, for every stop, the latest time to board there and still reach the destination by
 * the deadline with `k` rides; a round only keeps labels that beat every round before it, so
 * the origin departures of successive rounds form the Pareto front of departure time and rides.
 */

/** From each stop boarded this round, the stops one can change from to reach it in time. */
function relaxTransfers(run: Run, k: number, boarded: readonly number[]): number[] {
  const { footpaths } = run.request;
  const board = round(run.labels.board, k);
  for (const to of boarded) {
    const time = board[to] ?? NONE;
    for (let at = footpaths.start[to] ?? 0; at < (footpaths.start[to + 1] ?? 0); at += 1) {
      const from = footpaths.from[at] ?? 0;
      const seconds = footpaths.seconds[at] ?? 0;
      const latest = time - seconds;
      if (!usable(run.request, from) || latest < run.request.earliest) continue;
      if (latest <= run.bestOrigin || latest <= (run.bestAlight[from] ?? NONE)) continue;
      round(run.labels.alight, k)[from] = latest;
      round(run.labels.transferTo, k)[from] = to;
      round(run.labels.transferSeconds, k)[from] = seconds;
      run.bestAlight[from] = latest;
      run.improved[from] = 1;
    }
  }
  return takeImproved(run);
}

/** The latest departure from the origin with `k` rides; ties keep the lowest stop. */
function originDeparture(run: Run, k: number): FrontEntry | undefined {
  const board = round(run.labels.board, k);
  let best: FrontEntry | undefined;
  for (const walk of run.request.access) {
    const time = board[walk.stop] ?? NONE;
    if (time === NONE) continue;
    const departure = time - walk.seconds;
    if (departure < run.request.earliest) continue;
    if (best === undefined || departure > best.departure) {
      best = { rides: k, accessStop: walk.stop, departure };
    }
  }
  return best;
}

/** Seeds round 0 with the walks to the destination. */
function seedEgress(run: Run): number[] {
  const { request } = run;
  const egress = round(run.labels.alight, 0);
  for (const walk of request.egress) {
    const latest = request.deadline - walk.seconds;
    if (latest < request.earliest || latest <= (egress[walk.stop] ?? NONE)) continue;
    egress[walk.stop] = latest;
    run.bestAlight[walk.stop] = latest;
    run.improved[walk.stop] = 1;
  }
  return takeImproved(run);
}

export function runRaptor(request: SearchRequest): { labels: Labels; front: FrontEntry[] } {
  const run = createRun(request);
  let marked = seedEgress(run);
  const front: FrontEntry[] = [];
  for (let k = 1; k <= request.maxRides && marked.length > 0; k += 1) {
    scanRound(run, k, marked);
    const boarded = takeImproved(run);
    const origin = originDeparture(run, k);
    if (origin !== undefined && origin.departure > run.bestOrigin) {
      front.push(origin);
      run.bestOrigin = origin.departure;
    }
    marked = relaxTransfers(run, k, boarded);
  }
  return { labels: run.labels, front };
}
