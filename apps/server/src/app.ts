import { Hono } from 'hono';

import type { AppConfig } from './config/config.js';
import type { Clock } from './infrastructure/clock/clock.js';
import type { Database } from './infrastructure/database/database.js';
import type { Migration } from './infrastructure/database/migrations.js';
import type { HttpClient } from './infrastructure/http/client.js';
import { requestContext, type AppBindings } from './infrastructure/http/context.js';
import { limitBody } from './infrastructure/http/body-limit.js';
import { notFound, unexpectedError } from './infrastructure/http/errors.js';
import { requireSameOrigin } from './infrastructure/http/origin.js';
import { rateLimit, type RequestProtection } from './infrastructure/http/rate-limit.js';
import { webApp } from './infrastructure/http/web.js';
import { mapDiagnosticsRoutes } from './infrastructure/http/map-diagnostics.js';
import type { Logger } from './infrastructure/telemetry/logger.js';
import { createAirportBoardService } from './modules/airports/board.js';
import { airportRoutes } from './modules/airports/routes.js';
import { assistantRoutes } from './modules/assistant/routes.js';
import { agentWorkspaceRoutes } from './modules/agent-workspace/routes.js';
import { cityLayerRoutes } from './modules/city-layers/routes.js';
import type { Sara } from './modules/assistant/sara.js';
import type { CommerceDependencies } from './modules/commerce/context.js';
import { merchantRoutes } from './modules/commerce/merchant-routes.js';
import { travellerCommerceRoutes } from './modules/commerce/traveller-routes.js';
import { journeyRoutes } from './modules/journeys/routes.js';
import type { SourceReader } from './modules/data-platform/reader.js';
import { eventRoutes } from './modules/events/routes.js';
import type { LiveCity } from './modules/live/city.js';
import { liveRoutes } from './modules/live/routes.js';
import { createVirtualBusReader } from './modules/live/virtual-bus.js';
import { virtualRideRoutes } from './modules/virtual-rides/routes.js';
import { healthRoutes } from './modules/operations/health.js';
import { sessionRoutes } from './modules/operations/ops-auth.js';
import { opsRoutes, type OpsDependencies } from './modules/operations/ops-routes.js';
import { paymentsRoutes } from './modules/payments/routes.js';
import type { TicketAutopayService } from './modules/tickets/autopay.js';
import { ticketRoutes } from './modules/tickets/routes.js';
import { walletRoutes } from './modules/wallet/routes.js';
import type { TravelServices } from './travel.js';

export interface AppDependencies {
  readonly db: Database;
  readonly migrations: readonly Migration[];
  readonly clock: Clock;
  readonly logger: Logger;
  readonly version: string;
  readonly ops: OpsDependencies;
  readonly travel: {
    readonly services: TravelServices;
    /** Commerce on the way: the traveller's rewards and orders, and the merchant's panel. */
    readonly commerce: CommerceDependencies;
    /** The city Explore shows, kept warm by the process so the estimator learns while nobody looks. */
    readonly live: LiveCity;
    /** How the traveller's API reads the data platform (events today). */
    readonly reader: SourceReader;
    /** Camera pictures and parking signs, asked on demand with the generic browser identity. */
    readonly http: HttpClient;
    readonly sara: Sara;
    /** True in production, where the traveller cookie is sent only over HTTPS. */
    readonly secureCookies: boolean;
    readonly ticketDemoEnabled?: boolean;
    readonly paypalDemoBuyerEnabled?: boolean;
    readonly paypalDemoBuyer?: AppConfig['paypalDemoBuyer'];
    /** The assistant's way to pay for tickets with the traveller's PayPal. */
    readonly autopay?: TicketAutopayService;
  };
  /** The folder of the built web, served at `/` when it exists. */
  readonly webRoot?: string;
  readonly protection?: RequestProtection;
}

/** No request to the API needs more: larger bodies are refused before they are read. */
const MAX_BODY_BYTES = 64 * 1024;

/** Builds the HTTP application. Building it opens no port and starts no timer. */
export function createApp(deps: AppDependencies): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.use(requestContext(deps.logger));
  app.use('/api/*', rateLimit(deps.clock, deps.protection));
  app.use('/api/*', requireSameOrigin(deps.protection?.publicOrigin));
  app.use('/api/*', limitBody(MAX_BODY_BYTES));
  app.route('/', healthRoutes(deps));
  app.route('/api/diagnostics/map', mapDiagnosticsRoutes());
  app.route('/api/ops/session', sessionRoutes(deps.ops));
  app.route('/api/ops', opsRoutes(deps.ops));
  mountTravel(app, deps);
  const web = deps.webRoot === undefined ? undefined : webApp(deps.webRoot);
  if (web !== undefined) app.use('/*', web);
  app.notFound(notFound);
  app.onError(unexpectedError);
  return app;
}

/**
 * The traveller's API (payments, Sara, plans, journeys and rewards on the way, all on the
 * anonymous session), the city they move in, and the merchant's panel with its own session.
 */
function mountTravel(app: Hono<AppBindings>, deps: AppDependencies): void {
  const { db, clock } = deps;
  const { services, sara, secureCookies } = deps.travel;
  const sessions = { db, clock, secureCookies };
  app.route(
    '/api/payments',
    paymentsRoutes({
      db,
      clock,
      secureCookies,
      catalog: services.purchases,
      setup: services.payments,
    }),
  );
  app.route('/api', assistantRoutes({ sara, sessions }));
  app.route('/api/agents', agentWorkspaceRoutes({ sara, sessions, reader: deps.travel.reader }));
  app.route(
    '/api/tickets',
    ticketRoutes({
      ...sessions,
      sandbox: services.payments.available && services.payments.config.environment === 'sandbox',
      demoEnabled: deps.travel.ticketDemoEnabled === true,
      buyerEnabled: deps.travel.paypalDemoBuyerEnabled === true,
      buyer: deps.travel.paypalDemoBuyer,
      ...(deps.travel.autopay === undefined ? {} : { autopay: deps.travel.autopay }),
    }),
  );
  app.route(
    '/api/wallet',
    walletRoutes({
      ...sessions,
      sandbox: services.payments.available && services.payments.config.environment === 'sandbox',
      ...(deps.travel.autopay === undefined ? {} : { autopay: deps.travel.autopay }),
    }),
  );
  app.route('/api', journeyRoutes({ db, clock, planner: services.planner, sessions }));
  app.route('/api/commerce', travellerCommerceRoutes(deps.travel.commerce));
  app.route('/api/merchant', merchantRoutes(deps.travel.commerce));
  app.route('/api/live', liveRoutes({ db, clock, city: deps.travel.live }));
  app.route(
    '/api/virtual',
    virtualRideRoutes({
      ...sessions,
      commerce: deps.travel.commerce,
      planner: services.planner,
      geocoder: services.providers.geocoder,
      readVehicle: createVirtualBusReader({
        city: deps.travel.live,
        reader: deps.travel.reader,
        clock,
      }),
    }),
  );
  app.route('/api/events', eventRoutes({ reader: deps.travel.reader, clock }));
  app.route(
    '/api/city',
    cityLayerRoutes({
      reader: deps.travel.reader,
      clock,
      http: deps.travel.http,
    }),
  );
  app.route(
    '/api/airports',
    airportRoutes({
      service: createAirportBoardService({
        boards: services.providers.boards,
        reader: deps.travel.reader,
        clock,
      }),
    }),
  );
}
