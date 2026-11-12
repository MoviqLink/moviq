import { fileURLToPath } from 'node:url';

import { configSecrets, loadConfig, type AppConfig } from './config/config.js';
import { summarizeIntegrations } from './config/integrations.js';
import { systemClock, type Clock } from './infrastructure/clock/clock.js';
import { openDatabase, type Database } from './infrastructure/database/database.js';
import { migrate, readMigrations, type Migration } from './infrastructure/database/migrations.js';
import { createLogger, type Logger } from './infrastructure/telemetry/logger.js';
import { createShutdown } from './shutdown.js';

export type ProcessKind = 'api' | 'worker';

export interface Runtime {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock: Clock;
  readonly db: Database;
  readonly migrations: readonly Migration[];
}

/** Stops what `start` started. Called once, on SIGTERM or SIGINT. */
export type Stop = () => Promise<void>;

/** Exit code for a configuration error (EX_CONFIG in sysexits.h). */
export const EXIT_CONFIG = 78;

/** How long a process may take to stop before it is forced to exit. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

/** The server package folder, the same from `src/` and from `dist/`. */
const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url));

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../migrations/', import.meta.url));

/**
 * The shared life cycle of both processes: validate the configuration, open the database, bring
 * its schema up to date, run, and stop cleanly on a signal. A configuration error ends the
 * process before anything opens; a signal during start-up stops it once the current step ends.
 */
export async function runProcess(
  kind: ProcessKind,
  env: Readonly<Record<string, string | undefined>>,
  start: (runtime: Runtime) => Promise<Stop>,
): Promise<void> {
  const loaded = loadConfig(env);
  if (!loaded.ok) {
    const lines = loaded.problems.map((problem) => `  - ${problem}`).join('\n');
    process.stderr.write(`Configuration error, ${kind} not started:\n${lines}\n`);
    process.exitCode = EXIT_CONFIG;
    return;
  }
  const { config } = loaded;
  const logger = createLogger({
    level: config.logLevel,
    bindings: { process: kind, version: config.version },
    secrets: configSecrets(config),
  });
  const shutdown = createShutdown({
    source: process,
    exit: (code) => process.exit(code),
    logger,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
  });
  logger.info('starting', {
    appEnv: config.appEnv,
    paypalEnv: config.paypalEnv,
    publicDemo: config.publicDemo,
    integrations: summarizeIntegrations(config.integrations),
  });

  let db: Database | undefined;
  try {
    db = await openDatabase({
      url: config.database.url,
      authToken: config.database.authToken?.reveal(),
      baseDirectory: SERVER_ROOT,
    });
    const migrations = await readMigrations(MIGRATIONS_DIRECTORY);
    const appliedNow = await migrate(db, migrations, systemClock);
    logger.info('schema ready', { migrations: migrations.length, appliedNow });
    if (shutdown.requested) {
      stoppedDuringStartUp(logger);
      return;
    }
    const stop = await start({ config, logger, clock: systemClock, db, migrations });
    const signal = await shutdown.wait();
    logger.info('stopping', { signal });
    await shutdown.stopWithin(stop);
    logger.info('stopped');
  } catch (error) {
    if (shutdown.requested) {
      stoppedDuringStartUp(logger, error);
    } else {
      logger.error('failed', { error });
      process.exitCode = 1;
    }
  } finally {
    db?.close();
    shutdown.dispose();
  }
}

/** A stop asked for before the process was running: nothing was left half done. */
function stoppedDuringStartUp(logger: Logger, error?: unknown): void {
  logger.info('stopped during start-up', error === undefined ? {} : { interruptedBy: error });
}
