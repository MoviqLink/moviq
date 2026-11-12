import { toInstant, type Alternative, type FlightCheck, type Journey } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { SourceDefinition } from '../data-platform/definition.js';
import { interestStore } from '../data-platform/interests.js';
import type { SourceReader } from '../data-platform/reader.js';
import { findAlternatives } from './alternatives.js';
import { keptExplanation } from './explanation.js';
import type { FlightLive, FlightWatchSources } from './flight-facts.js';
import { checkFlight } from './flight-watch.js';
import { journeyStore, type StoredJourney } from './journey-store.js';
import type { FareRules, RoutingProvider } from './ports.js';
import { readStepFreeLists, STEP_FREE_SOURCES, type StepFreeReading } from './step-free-lists.js';
import {
  assessJourney,
  type LiveData,
  type PredictedTrip,
  type ServiceAlert,
} from './watch-assess.js';
import {
  checkElevators,
  stepFreeRefusal,
  withAccessibility,
  withElevators,
} from './watch-elevators.js';

export interface JourneyWatchDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly reader: SourceReader;
  readonly routing: RoutingProvider;
  readonly fares: FareRules;
  /** Feeds of live trips with predicted stops (subway and buses). */
  readonly predictionSources: readonly SourceDefinition<{
    readonly trips: readonly PredictedTrip[];
  }>[];
  readonly alertsSource: SourceDefinition<{ readonly alerts: readonly ServiceAlert[] }>;
  /** AeroDataBox, the FAA and ADS-B, read only in rounds with a journey planned around a flight. */
  readonly flightSources: FlightWatchSources;
  readonly intervalMs: number;
  /** Alternatives are looked for again no sooner than this. */
  readonly replanEveryMs: number;
}

/** A journey stops being watched this long after its planned arrival. */
const DONE_AFTER_MS = 60 * 60_000;

/**
 * The leader's watch over every active journey, whatever browser tabs are open. Each round reads
 * the live sources once, keeps them fast while journeys need them, and writes only what changed.
 */
export async function runJourneyWatch(
  term: LeaderTerm,
  deps: JourneyWatchDependencies,
): Promise<void> {
  const lastReplan = new Map<string, number>();
  while (!term.signal.aborted) {
    try {
      await watchRound(term, deps, lastReplan);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      deps.logger.error('journey watch round failed', { error });
    }
    await pause(deps.intervalMs, term.signal);
  }
}

async function watchRound(
  term: LeaderTerm,
  deps: JourneyWatchDependencies,
  lastReplan: Map<string, number>,
): Promise<void> {
  const journeys = await journeyStore.watching(deps.db);
  if (journeys.length === 0) return;
  const now = deps.clock.now();
  const flights = journeys.some((stored) => stored.journey.request.flight !== null)
    ? deps.flightSources
    : undefined;
  const sources = [
    ...deps.predictionSources,
    deps.alertsSource,
    ...STEP_FREE_SOURCES,
    ...(flights === undefined ? [] : [flights.airportStatus, ...flights.aircraft]),
  ];
  await interestStore.register(
    deps.db,
    {
      kind: 'journey',
      ref: 'watch',
      sourceIds: sources.map((source) => source.id),
      ttlMs: 3 * deps.intervalMs,
    },
    now,
  );
  const live: LiveData = {
    predictions: await Promise.all(
      deps.predictionSources.map((source) => deps.reader.read(source)),
    ),
    alerts: await deps.reader.read(deps.alertsSource),
  };
  const flightLive = flights === undefined ? undefined : await readFlightLive(deps, flights);
  const stepFree = await readStepFreeLists(deps.reader);
  for (const stored of journeys) {
    if (term.signal.aborted) return;
    await watchJourney(term, deps, stored, { live, flightLive, stepFree }, now, lastReplan);
  }
}

/** What one round reads once for every journey. */
interface Round {
  readonly live: LiveData;
  readonly flightLive: FlightLive | undefined;
  readonly stepFree: StepFreeReading;
}

async function readFlightLive(
  deps: JourneyWatchDependencies,
  flights: FlightWatchSources,
): Promise<FlightLive> {
  const [first, second] = flights.aircraft;
  return {
    airportStatus: await deps.reader.read(flights.airportStatus),
    aircraft: [await deps.reader.read(first), await deps.reader.read(second)],
    aircraftStaleAfterMs: first.freshness.staleAfterMs,
  };
}

async function watchJourney(
  term: LeaderTerm,
  deps: JourneyWatchDependencies,
  stored: StoredJourney,
  round: Round,
  now: Date,
  lastReplan: Map<string, number>,
): Promise<void> {
  if (now.getTime() > Date.parse(stored.journey.itinerary.arriveAt) + DONE_AFTER_MS) {
    await commit(term, deps, stored, { state: 'completed' }, 'completed', now);
    lastReplan.delete(stored.journey.id);
    return;
  }
  const step =
    round.flightLive === undefined
      ? undefined
      : await checkFlight(stored.journey, deps.flightSources, round.flightLive, now, term.signal);
  // A flight that moves sets a new deadline: the journey is assessed and replanned against it.
  const request =
    step === undefined || step.arriveBy === stored.journey.request.arriveBy
      ? stored.journey.request
      : { ...stored.journey.request, arriveBy: step.arriveBy };
  const planned = { ...stored.journey, request };
  const itinerary = withAccessibility(planned.itinerary, planned, round.stepFree, now);
  const journey = { ...planned, itinerary };
  const assessed = assessJourney(journey, round.live, now);
  const assessment = withElevators(
    { ...assessed, incidents: [...assessed.incidents, ...(step?.incidents ?? [])] },
    checkElevators(journey, round.stepFree, now),
  );
  let alternatives: readonly Alternative[] = assessment.needsAlternatives
    ? journey.alternatives
    : [];
  let refusal = assessment.needsAlternatives ? journey.watch.stepFreeRefusal : null;
  const replannedAt = lastReplan.get(journey.id) ?? Number.NEGATIVE_INFINITY;
  if (assessment.needsAlternatives && now.getTime() - replannedAt >= deps.replanEveryMs) {
    const found = await findAlternatives(journey, deps.routing, deps.fares, now, term.signal);
    alternatives = found.alternatives.map((alternative) => ({
      ...alternative,
      itinerary: withAccessibility(alternative.itinerary, journey, round.stepFree, now),
    }));
    refusal = stepFreeRefusal(found.refused, round.stepFree, journey, now);
    lastReplan.set(journey.id, now.getTime());
  }
  const watch: Journey['watch'] = {
    status: assessment.status,
    evaluatedAt: toInstant(now),
    projectedArriveAt:
      assessment.projectedArriveAt === null ? null : toInstant(assessment.projectedArriveAt),
    evidence: assessment.evidence,
    flight: step?.check ?? null,
    stepFreeRefusal: refusal,
    explanation: keptExplanation(stored.journey, assessment, alternatives),
  };
  const before = stored.journey;
  const sameAccess = said(itinerary) === said(before.itinerary);
  const unchanged =
    watch.status === before.watch.status &&
    watch.evidence === before.watch.evidence &&
    watch.projectedArriveAt === before.watch.projectedArriveAt &&
    request === before.request &&
    sameAccess &&
    JSON.stringify(refusal) === JSON.stringify(before.watch.stepFreeRefusal) &&
    sameCheck(watch.flight, before.watch.flight) &&
    sameIds(assessment.incidents, before.incidents) &&
    sameIds(alternatives, before.alternatives);
  if (unchanged) return;
  const kind = watch.status === before.watch.status ? 'watched' : `status:${watch.status}`;
  const changes = {
    watch,
    incidents: [...assessment.incidents],
    alternatives: [...alternatives],
    ...(request === before.request ? {} : { request }),
    ...(sameAccess ? {} : { itinerary }),
  };
  // Written over meanwhile (by Sara's words, or a payment): look for alternatives again next round.
  if (!(await commit(term, deps, stored, changes, kind, now))) lastReplan.delete(journey.id);
}

/** What a step-free check says, whatever the age of the outages read. */
function said(itinerary: Journey['itinerary']): string {
  const access = itinerary.accessibility ?? null;
  return access === null
    ? 'none'
    : JSON.stringify([
        access.checkedAt,
        access.provenance.state,
        access.platforms,
        access.warnings,
      ]);
}

/** Two checks that say the same, whatever the age of their readings. */
function sameCheck(a: FlightCheck | null, b: FlightCheck | null): boolean {
  const said = (check: FlightCheck | null) =>
    check === null
      ? null
      : JSON.stringify([
          check.departure,
          check.movement,
          check.evidence,
          check.discrepancies,
          check.aerodatabox?.provenance.dataTime ?? null,
          check.readings.map((reading) => [
            reading.sourceId,
            reading.says,
            reading.provenance.state,
          ]),
        ]);
  return said(a) === said(b);
}

async function commit(
  term: LeaderTerm,
  deps: JourneyWatchDependencies,
  stored: StoredJourney,
  changes: Parameters<typeof journeyStore.update>[3],
  kind: string,
  now: Date,
): Promise<boolean> {
  const applied = await term.fenced(async (tx) => {
    const updated = await journeyStore.update(tx, stored.journey.id, stored.version, changes, now);
    if (updated) await journeyStore.addEvent(tx, stored.journey.id, kind, changes, now);
    return updated;
  });
  if (!applied)
    deps.logger.info('journey changed meanwhile; watched again next round', {
      journey: stored.journey.id,
    });
  return applied;
}

function sameIds(
  a: readonly { readonly id: string }[],
  b: readonly { readonly id: string }[],
): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index]?.id);
}
