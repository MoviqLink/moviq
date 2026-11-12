import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { SourceReader } from '../../data-platform/reader.js';
import type { ProviderOutcome, RoutedItinerary, RoutingProvider } from '../ports.js';
import { platformEngineSources } from './platform-sources.js';
import { createEngineRouting } from './provider.js';
import type { StreetWalks } from './street-walks.js';

type Outcome = ProviderOutcome<readonly RoutedItinerary[]>;

export interface MovIqRoutingOptions {
  /** The platform reader, `createSourceReader` of the process. */
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** Asked only when the engine has no answer to a trip that is not step-free: Transitous. */
  readonly fallback: RoutingProvider;
  /** The streets the engine's walks are walked on: Transitous on foot. */
  readonly streets?: StreetWalks;
}

/**
 * The engine first and the fallback when the engine says no: each answer keeps the provenance
 * of whoever gave it, and the fallback's says why the engine did not. A plan cancelled by its
 * caller is not asked again. Nor is a step-free plan: the fallback knows neither the MTA station
 * list nor the elevator outages, so its answer would not be step-free (from 96 St to Van
 * Cortlandt Park-242 St it gave the 1 to 242 St, a station without step-free access).
 */
function withFallback(primary: RoutingProvider, fallback: RoutingProvider): RoutingProvider {
  return {
    sourceId: `${primary.sourceId}+${fallback.sourceId}`,
    async plan(query, signal): Promise<Outcome> {
      const first = await primary.plan(query, signal);
      if (first.ok || query.stepFree || signal?.aborted === true) return first;
      const reason = `${primary.sourceId} had no answer (${first.code}: ${first.detail})`;
      const second = await fallback.plan(query, signal);
      if (!second.ok) {
        return { ...first, detail: `${first.detail} ${fallback.sourceId}: ${second.detail}` };
      }
      const evidence = `${reason}. ${second.provenance.evidence}`;
      return { ...second, provenance: { ...second.provenance, evidence } };
    },
  };
}

/**
 * MovIQ's routing, ready to connect: its own RAPTOR engine over the seven MTA timetables served
 * by the data platform, with the subway and Bus Time predictions and step-free stations, then
 * the fallback when the engine has no answer to a trip that is not step-free.
 */
export function createMovIqRouting(options: MovIqRoutingOptions): RoutingProvider {
  const engine = createEngineRouting({
    sources: platformEngineSources(options.reader),
    clock: options.clock,
    ...(options.streets === undefined ? {} : { streets: options.streets }),
  });
  return withFallback(engine, options.fallback);
}
