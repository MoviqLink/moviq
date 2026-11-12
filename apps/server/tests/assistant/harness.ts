import { assistantTurnSchema, type AssistantTurn } from '@moviq/contracts';
import { Hono } from 'hono';
import { expect } from 'vitest';

import type { Clock } from '../../src/infrastructure/clock/clock.js';
import type { Database } from '../../src/infrastructure/database/database.js';
import { requestContext, type AppBindings } from '../../src/infrastructure/http/context.js';
import { unexpectedError } from '../../src/infrastructure/http/errors.js';
import { createTokenBudget, type TokenBudget } from '../../src/modules/assistant/budget.js';
import type { LanguageModel } from '../../src/modules/assistant/model/language-model.js';
import type { CommerceDependencies } from '../../src/modules/commerce/context.js';
import { assistantRoutes } from '../../src/modules/assistant/routes.js';
import { createSara } from '../../src/modules/assistant/sara.js';
import { memoryLogger, type MemoryLogger } from '../support/memory-logger.js';
import { fakeCity, fakeReader, type Served } from './city-doubles.js';
import {
  BRYANT_PARK,
  fakeFlights,
  fakeGeocoder,
  fakePlanner,
  flight,
  HARLEM_456,
  HARLEM_ACBD,
  HARLEM_STREET,
  JFK,
} from './doubles.js';

export interface HarnessOptions {
  readonly db: Database;
  readonly clock: Clock;
  readonly model?: LanguageModel | undefined;
  readonly dailyTokens?: number;
  readonly geocoderDown?: boolean;
  readonly flightsDown?: boolean | 'no-units';
  readonly places?: Parameters<typeof fakeGeocoder>[0];
  /** Sources served to the city tools, by id; none by default. */
  readonly served?: Readonly<Record<string, Served>>;
  readonly city?: ReturnType<typeof fakeCity>;
  /** The demo merchants Sara may ask on a trip; none by default. */
  readonly commerce?: CommerceDependencies;
}

export interface Harness {
  readonly app: Hono<AppBindings>;
  readonly log: MemoryLogger;
  readonly planner: ReturnType<typeof fakePlanner>;
  readonly budget: TokenBudget;
}

export const PLACES = {
  'Bryant Park': [BRYANT_PARK, HARLEM_STREET],
  '125th Street': [HARLEM_ACBD, HARLEM_456, HARLEM_STREET],
  '125 Street': [HARLEM_STREET],
  'John F. Kennedy International Airport': [JFK],
};

/** The assistant mounted under `/api` as the application mounts it, with doubles for its ports. */
export function harness(options: HarnessOptions): Harness {
  const log = memoryLogger();
  const planner = fakePlanner();
  const budget = createTokenBudget(options.db, options.clock, options.dailyTokens ?? 100_000);
  const sara = createSara({
    db: options.db,
    clock: options.clock,
    geocoder: fakeGeocoder(options.places ?? PLACES, { down: options.geocoderDown ?? false }),
    flights: fakeFlights(
      {
        'DL 405 2026-11-11': flight(),
        'AA 1234 2026-11-12': flight({
          carrier: 'AA',
          number: '1234',
          departureAt: '2026-11-12T15:00:00.000Z',
        }),
      },
      { down: options.flightsDown ?? false },
    ),
    planner,
    reader: fakeReader(options.served ?? {}),
    live: options.city ?? fakeCity(),
    model: options.model,
    budget,
    ...(options.commerce === undefined ? {} : { commerce: options.commerce }),
  });
  const app = new Hono<AppBindings>();
  app.use(requestContext(log.logger));
  app.route(
    '/api',
    assistantRoutes({
      sara,
      sessions: { db: options.db, clock: options.clock, secureCookies: false },
    }),
  );
  app.onError(unexpectedError);
  return { app, log, planner, budget };
}

export interface Device {
  say(message: string, lang?: 'en' | 'es'): Promise<AssistantTurn>;
}

/** One device talking to Sara: it keeps its session cookie and its conversation id. */
export function device(app: Hono<AppBindings>): Device {
  let cookie: string | undefined;
  let conversationId: string | null = null;
  return {
    async say(message, lang = 'en') {
      const response = await app.request('/api/assistant/turns', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ conversationId, message, lang }),
      });
      expect(response.status).toBe(200);
      cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
      const turn = assistantTurnSchema.parse(await response.json());
      conversationId = turn.conversationId;
      return turn;
    },
  };
}
