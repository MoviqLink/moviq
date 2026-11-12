import { randomUUID } from 'node:crypto';

import { runProcess } from './bootstrap.js';
import { commerceServices } from './commerce.js';
import { configSecrets } from './config/config.js';
import { createHttpClient } from './infrastructure/http/client.js';
import { runAsLeader } from './infrastructure/jobs/leadership.js';
import { createLeaseStore } from './infrastructure/jobs/lease.js';
import { createTokenBudget } from './modules/assistant/budget.js';
import { createTextSanitizer } from './infrastructure/telemetry/sanitize.js';
import { createCollector } from './modules/data-platform/collector.js';
import { credentialsFrom } from './modules/data-platform/credentials.js';
import { createSourceReader } from './modules/data-platform/reader.js';
import { travelServices } from './travel.js';
import { runLeaderJobs } from './worker-jobs.js';

const LEASE_NAME = 'worker';

await runProcess('worker', process.env, ({ config, logger, clock, db }) => {
  const controller = new AbortController();
  const ttlMs = config.worker.leaseTtlMs;
  const credentials = credentialsFrom(config.integrations);
  const http = createHttpClient({ redirectTo: config.testProviderOrigin });
  const reader = createSourceReader({ db, clock, missingVariables: credentials.missingVariables });
  const services = travelServices({ config, db, clock, http, reader });
  const commerce = commerceServices({
    env: process.env,
    config,
    db,
    clock,
    http,
    logger,
    payments: services.payments,
    model: undefined,
    budget: createTokenBudget(db, clock, config.assistant.dailyTokenBudget),
  });
  const jobs = {
    config,
    db,
    clock,
    logger,
    collect: createCollector({
      db,
      http,
      clock,
      logger,
      credentials: credentials.resolve,
      sanitize: createTextSanitizer(configSecrets(config)),
    }),
    missingVariables: credentials.missingVariables,
    reader,
    services,
    commerce,
  };
  const running = runAsLeader({
    db,
    clock,
    store: createLeaseStore(db, clock),
    name: LEASE_NAME,
    holder: `worker-${String(process.pid)}-${randomUUID()}`,
    ttlMs,
    intervalMs: Math.floor(ttlMs / 3),
    logger,
    signal: controller.signal,
    work: (term) => runLeaderJobs(term, jobs),
  });
  return Promise.resolve(async () => {
    controller.abort();
    await running;
  });
});
