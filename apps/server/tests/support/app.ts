import { createApp } from '../../src/app.js';
import { Secret } from '../../src/config/secret.js';
import type { Clock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import type { Migration } from '../../src/infrastructure/database/migrations.js';
import { createHttpClient } from '../../src/infrastructure/http/client.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import { createSara } from '../../src/modules/assistant/sara.js';
import { commerceServices } from '../../src/commerce.js';
import type { SourceDefinition } from '../../src/modules/data-platform/definition.js';
import { createSourceReader } from '../../src/modules/data-platform/reader.js';
import { createLiveCity } from '../../src/modules/live/city.js';
import type { PaymentsSetup } from '../../src/modules/payments/setup.js';
import { travelServices } from '../../src/travel.js';
import { memoryLogger, type MemoryLogger } from './memory-logger.js';

import { MERCHANT_TEST_TOKEN } from './merchant-access.js';

export const ADMIN_TOKEN = 'admin-token-for-tests-0123456789abcdef';
export const VIEWER_TOKEN = 'viewer-token-for-tests-0123456789abcdef';

export interface TestAppOptions {
  readonly db: Database;
  readonly migrations: readonly Migration[];
  readonly clock: Clock;
  readonly definitions?: readonly SourceDefinition[];
  readonly version?: string;
  readonly webRoot?: string;
  /** PayPal for commerce, such as the in-memory double of holds; unavailable by default. */
  readonly payments?: PaymentsSetup;
}

/** Every provider request goes here, where nothing listens: the full app never leaves the Mac. */
const NOWHERE = 'http://127.0.0.1:9';

/** The real application with test tokens, no sources by default and no provider credentials. */
export function testApp(options: TestAppOptions): {
  app: ReturnType<typeof createApp>;
  log: MemoryLogger;
} {
  const log = memoryLogger();
  const { db, clock } = options;
  const http = createHttpClient({ redirectTo: NOWHERE });
  const reader = createSourceReader({ db, clock, missingVariables: () => [] });
  const services = travelServices({
    config: { integrations: [], paypalEnv: 'sandbox' },
    db,
    clock,
    http,
    reader,
  });
  const live = createLiveCity({ reader, clock });
  const budget = createTokenBudget(db, clock, 0);
  const commerce = commerceServices({
    env: { ORDER_CODE_SECRET: 'order-code-secret-for-tests-0123456789' },
    config: {
      integrations: [],
      paypalEnv: 'sandbox',
      appEnv: 'test',
      merchantAccessToken: new Secret(MERCHANT_TEST_TOKEN),
    },
    db,
    clock,
    http,
    logger: log.logger,
    payments: options.payments ?? services.payments,
    model: undefined,
    budget,
  });
  const sara = createSara({
    db,
    clock,
    geocoder: services.providers.geocoder,
    flights: services.providers.flights,
    planner: services.planner,
    reader,
    live,
    model: undefined,
    budget,
    commerce,
  });
  const app = createApp({
    db: options.db,
    migrations: options.migrations,
    clock: options.clock,
    logger: log.logger,
    version: options.version ?? '1.2.3',
    ops: {
      db: options.db,
      clock: options.clock,
      tokens: { admin: new Secret(ADMIN_TOKEN), viewer: new Secret(VIEWER_TOKEN) },
      secureCookies: false,
      sources: { definitions: options.definitions ?? [], missingVariables: () => [] },
      version: options.version ?? '1.2.3',
      heartbeatMs: 30_000,
      recorder: {
        db: options.db,
        clock: options.clock,
        definitions: options.definitions ?? [],
        extractors: [],
        directory: undefined,
        retentionDays: 7,
      },
    },
    travel: {
      services,
      commerce,
      sara,
      secureCookies: false,
      live,
      reader,
      http,
    },
    ...(options.webRoot === undefined ? {} : { webRoot: options.webRoot }),
  });
  return { app, log };
}
