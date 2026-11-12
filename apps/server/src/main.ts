import { fileURLToPath } from 'node:url';

import { serve, type ServerType } from '@hono/node-server';

import { getConnInfo } from '@hono/node-server/conninfo';

import { createApp } from './app.js';
import { runProcess } from './bootstrap.js';
import { commerceServices } from './commerce.js';
import type { AppConfig } from './config/config.js';
import type { Clock } from './infrastructure/clock/clock.js';
import type { Database } from './infrastructure/database/database.js';
import { createHttpClient, type HttpClient } from './infrastructure/http/client.js';
import type { RequestProtection } from './infrastructure/http/rate-limit.js';
import type { Logger } from './infrastructure/telemetry/logger.js';
import { createTokenBudget } from './modules/assistant/budget.js';
import { openAIModelFromConfig } from './modules/assistant/model/openai.js';
import { watchLineForPrimary } from './modules/agent-workspace/store.js';
import { createSara } from './modules/assistant/sara.js';
import { createTicketAutopay } from './modules/tickets/autopay.js';
import { sourceCatalog } from './modules/data-platform/catalog.js';
import { credentialsFrom } from './modules/data-platform/credentials.js';
import type { SourceDefinition } from './modules/data-platform/definition.js';
import { createSourceReader, type SourceReader } from './modules/data-platform/reader.js';
import { createLiveCity, type LiveCity } from './modules/live/city.js';
import { createPositionEstimator } from './modules/live/estimation/estimator.js';
import { createRecordedStatistics } from './modules/live/estimation/recorded.js';
import { keepCityWarm } from './modules/live/warm.js';
import type { OpsDependencies } from './modules/operations/ops-routes.js';
import { recorderExtractors } from './modules/recorder/extractors/index.js';
import { travelServices, type TravelServices } from './travel.js';

const demoBuyerConfig = (config: AppConfig) => ({
  paypalDemoBuyerEnabled: config.paypalDemoBuyerEnabled,
  paypalDemoBuyer: config.paypalDemoBuyer,
});

/** The web build, next to the server package in the repository. */
const WEB_ROOT = fileURLToPath(new URL('../../web/dist/', import.meta.url));

await runProcess('api', process.env, async ({ config, logger, clock, db, migrations }) => {
  const secureCookies = config.appEnv === 'production';
  const { missingVariables } = credentialsFrom(config.integrations);
  const http = createHttpClient({ redirectTo: config.testProviderOrigin });
  const reader = createSourceReader({ db, clock, missingVariables });
  const services = travelServices({ config, db, clock, http, reader });
  const recorded = createRecordedStatistics({
    db,
    clock,
    reader,
    onError: (error) => {
      logger.warn('recorder statistics read failed', { error });
    },
  });
  recorded.start();
  const live = createLiveCity({
    reader,
    clock,
    estimate: createPositionEstimator(recorded.statistics),
  });
  const warm = keepCityWarm(live, (error) => {
    logger.error('explore city build failed', { error });
  });
  const { commerce, autopay, sara } = assistantServices({
    config,
    db,
    clock,
    http,
    logger,
    services,
    reader,
    live,
  });
  const app = createApp({
    db,
    migrations,
    clock,
    logger,
    version: config.version,
    ops: opsDependencies({ config, db, clock, secureCookies, missingVariables }),
    travel: {
      services,
      commerce,
      sara,
      autopay,
      secureCookies,
      ticketDemoEnabled: config.ticketDemoEnabled,
      ...demoBuyerConfig(config),
      live,
      reader,
      http,
    },
    webRoot: WEB_ROOT,
    protection: requestProtection(config),
  });
  const server = await listen(app.fetch, config.http.host, config.http.port);
  server.on('error', (error) => {
    logger.error('http server error', { error });
  });
  logger.info('listening', { host: config.http.host, port: config.http.port });
  return async () => {
    warm.stop();
    await recorded.stop();
    await close(server);
  };
});

/** Sara and what she can act with: the commerce agents and the tickets she may buy. */
function assistantServices(input: {
  readonly config: AppConfig;
  readonly db: Database;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly logger: Logger;
  readonly services: TravelServices;
  readonly reader: SourceReader;
  readonly live: LiveCity;
}) {
  const { config, db, clock, http, logger, services, reader, live } = input;
  const model = openAIModelFromConfig(config);
  const budget = createTokenBudget(db, clock, config.assistant.dailyTokenBudget);
  const commerce = commerceServices({
    env: process.env,
    config,
    db,
    clock,
    http,
    logger,
    payments: services.payments,
    model,
    budget,
  });
  const autopay = createTicketAutopay({
    db,
    clock,
    payments: services.payments,
    catalog: services.purchases,
    demoAgreementId: config.ticketDemoEnabled ? config.paypalDemoAgreementId : undefined,
  });
  const sara = createSara({
    tickets: autopay,
    watches: {
      watchLine: (travellerId, line) => watchLineForPrimary(db, travellerId, line, clock.now()),
    },
    db,
    clock,
    geocoder: services.providers.geocoder,
    flights: services.providers.flights,
    planner: services.planner,
    reader,
    live,
    model,
    budget,
    commerce,
  });
  return { commerce, autopay, sara };
}

/** The control panel: its tokens, the catalogue with what each source lacks, and the recorder. */
function opsDependencies(input: {
  readonly config: AppConfig;
  readonly db: Database;
  readonly clock: Clock;
  readonly secureCookies: boolean;
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
}): OpsDependencies {
  const { config, db, clock } = input;
  return {
    db,
    clock,
    tokens: { admin: config.adminToken, viewer: config.viewerToken },
    secureCookies: input.secureCookies,
    publicOrigin: config.publicOrigin,
    sources: {
      definitions: sourceCatalog,
      missingVariables: input.missingVariables,
    },
    version: config.version,
    heartbeatMs: config.worker.heartbeatMs,
    recorder: {
      db,
      clock,
      definitions: sourceCatalog,
      extractors: recorderExtractors,
      directory: config.recording.directory,
      retentionDays: config.recording.retentionDays,
    },
  };
}

function listen(
  fetch: (request: Request) => Response | Promise<Response>,
  hostname: string,
  port: number,
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname, port }, () => {
      server.off('error', reject);
      resolve(server);
    });
    server.once('error', reject);
  });
}

function close(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    if ('closeIdleConnections' in server) server.closeIdleConnections();
  });
}

/** Only the transport supplies client addresses; request headers cannot impersonate a peer. */
function requestProtection(config: AppConfig): RequestProtection {
  return {
    publicOrigin: config.publicOrigin,
    clientAddress: (c) => getConnInfo(c).remote.address,
  };
}
