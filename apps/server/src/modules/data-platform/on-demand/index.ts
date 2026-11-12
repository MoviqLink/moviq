import type { IntegrationState } from '../../../config/integrations.js';
import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { HttpClient } from '../../../infrastructure/http/client.js';
import { omnyFareRules } from '../../journeys/fares/omny.js';
import type { StreetWalks } from '../../journeys/engine/street-walks.js';
import type { FareRules, FlightFinder, Geocoder, RoutingProvider } from '../../journeys/ports.js';
import { createAeroDataBoxFlights } from './aerodatabox.js';
import { aeroDataBoxCredential, createAeroDataBoxGateway } from './aerodatabox-gateway.js';
import { createUnitAllowance } from './aerodatabox-units.js';
import { createAirportBoards, type AirportBoards } from './airport-boards.js';
import { createBoardBudget } from './board-budget.js';
import { cachedFlights } from './flight-cache.js';
import { createNycGeoSearch } from './geosearch.js';
import { createDailyBudget } from './daily-budget.js';
import { createTransitousRouting, TRANSITOUS_DAILY_REQUESTS } from './transitous.js';
import { createTransitousStreets } from './transitous-streets.js';

export interface OnDemandProviders {
  readonly routing: RoutingProvider;
  /** Walks on the streets for the engine's itineraries, on the same Transitous count. */
  readonly streets: StreetWalks;
  readonly geocoder: Geocoder;
  readonly flights: FlightFinder;
  readonly fares: FareRules;
  /** JFK, LaGuardia and Newark's departures and arrivals, on the same units as `flights`. */
  readonly boards: AirportBoards;
}

export interface OnDemandDependencies {
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly integrations: readonly IntegrationState[];
}

/**
 * The end of the competition's evaluation (1 to 15/12/2026, New York): until then, boards spread
 * their units up to it rather than over the whole month, so those days get the most boards.
 */
const EVALUATION_ENDS = new Date('2026-12-16T05:00:00Z');

/** What journeys ask the outside world for, built once per process with its dependencies. */
export function createOnDemandProviders(dependencies: OnDemandDependencies): OnDemandProviders {
  const { http, clock } = dependencies;
  const units = createUnitAllowance();
  const transitous = createDailyBudget(TRANSITOUS_DAILY_REQUESTS);
  const gateway = createAeroDataBoxGateway({
    http,
    clock,
    credential: aeroDataBoxCredential(dependencies.integrations),
    units,
  });
  return {
    routing: createTransitousRouting({ http, clock, budget: transitous }),
    streets: createTransitousStreets({ http, clock, budget: transitous }),
    geocoder: createNycGeoSearch({ http, clock }),
    flights: cachedFlights(createAeroDataBoxFlights(gateway), clock),
    fares: omnyFareRules,
    boards: createAirportBoards({
      gateway,
      budget: createBoardBudget(units, { spreadUntil: EVALUATION_ENDS }),
      clock,
    }),
  };
}
