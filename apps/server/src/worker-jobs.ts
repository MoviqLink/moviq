import type { AppConfig } from './config/config.js';
import type { Clock } from './infrastructure/clock/clock.js';
import type { Database } from './infrastructure/database/database.js';
import type { LeaderTerm } from './infrastructure/jobs/leadership.js';
import type { Logger } from './infrastructure/telemetry/logger.js';
import { runAgentWatches } from './modules/agent-workspace/watch.js';
import type { CommerceDependencies } from './modules/commerce/context.js';
import { commercePurchases } from './modules/commerce/hold-purchases.js';
import { settleMerchants } from './modules/commerce/jobs.js';
import { sourceCatalog } from './modules/data-platform/catalog.js';
import type { Collect } from './modules/data-platform/collector.js';
import type { SourceDefinition } from './modules/data-platform/definition.js';
import type { SourceReader } from './modules/data-platform/reader.js';
import { runScheduler } from './modules/data-platform/scheduler.js';
import { adsbFiSource } from './modules/data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from './modules/data-platform/sources/air/adsb-lol.js';
import { faaAirportStatusSource } from './modules/data-platform/sources/city/faa-airport-status.js';
import { mtaAlerts } from './modules/data-platform/sources/mta/alerts.js';
import { busSources } from './modules/data-platform/sources/mta/bus-realtime.js';
import { subwaySources } from './modules/data-platform/sources/mta/subway-realtime.js';
import { runJourneyWatch } from './modules/journeys/watch.js';
import { upgradeRailTimetables } from './modules/live/rail-upgrade.js';
import { runHeartbeat } from './modules/operations/heartbeat.js';
import { reconcileHolds } from './modules/payments/holds/hold-reconcile.js';
import { reconcilePayments } from './modules/payments/reconcile.js';
import { recorderExtractors } from './modules/recorder/extractors/index.js';
import { runNightly } from './modules/recorder/nightly/nightly.js';
import { runRecorder } from './modules/recorder/recorder.js';
import type { TravelServices } from './travel.js';

const HEARTBEAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Each look reads about 30 rows; every 2 s that is ~40 M a month, well inside 500 M. */
const SCHEDULER_TICK_MS = 2_000;
/** The subway and Bus Time feeds change about every 30 s; looking more often finds nothing new. */
const JOURNEY_WATCH_MS = 20_000;
/** Alternatives are looked for again at most this often for one journey. */
const REPLAN_EVERY_MS = 5 * 60_000;
/** PayPal answers in seconds; a payment in doubt is read back within this pause. */
const RECONCILE_EVERY_MS = 15_000;
/** Real-time versions are replaced every 30 s at most; looking every 5 s reads each one. */
const RECORDER_TICK_MS = 5_000;
/** Merchants are paid weekly; the payout batches PayPal has not settled are read this often. */
const PAYOUTS_EVERY_MS = 10 * 60_000;
/** Whether a day is due (after 04:00 in New York) is looked at every 10 minutes. */
const NIGHTLY_CHECK_MS = 10 * 60_000;
const [, busTripUpdates] = busSources;

export interface LeaderJobDependencies {
  readonly config: AppConfig;
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly collect: Collect;
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
  readonly reader: SourceReader;
  readonly services: TravelServices;
  readonly commerce: CommerceDependencies;
}

/** Everything the lease holder does, for as long as it holds the lease. */
export async function runLeaderJobs(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void> {
  await Promise.all([
    ...dataJobs(term, deps),
    ...travelJobs(term, deps),
    runAgentWatches(term, {
      db: deps.db,
      clock: deps.clock,
      reader: deps.reader,
      logger: deps.logger.child({ job: 'agent-watches' }),
      intervalMs: 60_000,
    }),
    ...commerceJobs(term, deps),
    ...recordingJobs(term, deps),
  ]);
}

/** The hosting probe and the collection of every source. */
function dataJobs(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void>[] {
  const { config, clock, logger } = deps;
  return [
    runHeartbeat(term, {
      clock,
      intervalMs: config.worker.heartbeatMs,
      retentionMs: HEARTBEAT_RETENTION_MS,
      logger,
    }),
    runRailAwareScheduler(term, deps),
  ];
}

async function runRailAwareScheduler(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void> {
  const { db, clock, logger } = deps;
  try {
    await upgradeRailTimetables(term, deps);
  } catch (error) {
    logger.error('source snapshot upgrade failed', { error });
  }
  await runScheduler(term, {
    db,
    clock,
    logger,
    definitions: sourceCatalog,
    collect: deps.collect,
    missingVariables: deps.missingVariables,
    tickMs: SCHEDULER_TICK_MS,
    lanes: { realtime: 4, static: 1 },
    retentionMs: RUN_RETENTION_MS,
    random: Math.random,
  });
}

/** Watched journeys and payments PayPal has not settled yet. */
function travelJobs(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void>[] {
  const { db, clock, logger, services } = deps;
  return [
    runJourneyWatch(term, {
      db,
      clock,
      logger: logger.child({ job: 'journeys' }),
      reader: deps.reader,
      routing: services.routing,
      fares: services.providers.fares,
      predictionSources: [...subwaySources, busTripUpdates],
      alertsSource: mtaAlerts,
      flightSources: {
        flights: services.providers.flights,
        airportStatus: faaAirportStatusSource,
        aircraft: [adsbLolSource, adsbFiSource],
      },
      intervalMs: JOURNEY_WATCH_MS,
      replanEveryMs: REPLAN_EVERY_MS,
    }),
    reconcilePayments(term, {
      db,
      clock,
      logger: logger.child({ job: 'payments' }),
      catalog: services.purchases,
      setup: services.payments,
      intervalMs: RECONCILE_EVERY_MS,
    }),
  ];
}

/** Holds PayPal has not settled, and the weekly payouts to the merchants. */
function commerceJobs(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void>[] {
  const { db, clock, logger } = deps;
  return [
    reconcileHolds(term, {
      db,
      clock,
      logger: logger.child({ job: 'holds' }),
      purchases: commercePurchases({ clock }),
      setup: deps.services.payments,
      intervalMs: RECONCILE_EVERY_MS,
    }),
    settleMerchants(term, {
      ...deps.commerce,
      logger: logger.child({ job: 'payouts' }),
      intervalMs: PAYOUTS_EVERY_MS,
    }),
  ];
}

/** The recorder and its nightly statistics. */
function recordingJobs(term: LeaderTerm, deps: LeaderJobDependencies): Promise<void>[] {
  const { config, db, clock, logger } = deps;
  const recording = {
    db,
    clock,
    definitions: sourceCatalog,
    extractors: recorderExtractors,
    directory: config.recording.directory,
  };
  return [
    runRecorder(term, {
      ...recording,
      logger: logger.child({ job: 'recorder' }),
      intervalMs: RECORDER_TICK_MS,
    }),
    runNightly(term, {
      ...recording,
      logger: logger.child({ job: 'nightly' }),
      retentionDays: config.recording.retentionDays,
      checkEveryMs: NIGHTLY_CHECK_MS,
    }),
  ];
}
