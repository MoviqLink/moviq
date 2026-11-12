import type { PaymentPurpose } from '@moviq/contracts';
import type { AppConfig } from './config/config.js';
import type { Clock } from './infrastructure/clock/clock.js';
import type { Database } from './infrastructure/database/database.js';
import type { HttpClient } from './infrastructure/http/client.js';
import {
  createOnDemandProviders,
  type OnDemandProviders,
} from './modules/data-platform/on-demand/index.js';
import type { SourceReader } from './modules/data-platform/reader.js';
import { createMovIqRouting } from './modules/journeys/engine/moviq-routing.js';
import type { JourneyPlanner, RoutingProvider } from './modules/journeys/ports.js';
import { createPlanner } from './modules/journeys/planner.js';
import { journeyPurchases } from './modules/journeys/purchases.js';
import { ticketPurchases } from './modules/tickets/purchases.js';
import { walletTopUps } from './modules/wallet/purchases.js';
import type { PurchaseCatalog } from './modules/payments/catalog.js';
import { paymentsSetup, type PaymentsSetup } from './modules/payments/setup.js';

/** The traveller-side services the API and the worker share, each built from the configuration. */
export interface TravelServices {
  readonly providers: OnDemandProviders;
  /** MovIQ's own engine first; Transitous answers only when the engine cannot. */
  readonly routing: RoutingProvider;
  readonly planner: JourneyPlanner;
  /** Server-priced journey alternatives and sandbox transit demonstrations. */
  readonly purchases: PurchaseCatalog;
  readonly payments: PaymentsSetup;
}

export function travelServices(input: {
  readonly config: Pick<AppConfig, 'integrations' | 'paypalEnv'>;
  readonly db: Database;
  readonly clock: Clock;
  readonly http: HttpClient;
  readonly reader: SourceReader;
}): TravelServices {
  const { config, db, clock, http, reader } = input;
  const providers = createOnDemandProviders({ http, clock, integrations: config.integrations });
  const routing = createMovIqRouting({
    reader,
    clock,
    fallback: providers.routing,
    streets: providers.streets,
  });
  const payments = paymentsSetup({ config, http, clock });
  const journeys = journeyPurchases({ db, clock });
  const sandbox = payments.available && payments.config.environment === 'sandbox';
  const tickets = ticketPurchases({ db, sandbox });
  const topUps = walletTopUps({ db, sandbox });
  /** The module that owns each kind of purchase prices it and applies it. */
  const ownerOf = (purpose: PaymentPurpose): PurchaseCatalog => {
    if (purpose.kind === 'ticket-product') return tickets;
    return purpose.kind === 'wallet-top-up' ? topUps : journeys;
  };
  return {
    providers,
    routing,
    planner: createPlanner({ db, clock, routing, fares: providers.fares, reader }),
    purchases: {
      quote: (purpose, travellerId) => ownerOf(purpose).quote(purpose, travellerId),
      fulfil: (purpose, paymentId, tx) => ownerOf(purpose).fulfil(purpose, paymentId, tx),
    },
    payments,
  };
}
