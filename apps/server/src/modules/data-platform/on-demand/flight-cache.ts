import type { Flight } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { FlightFinder, FlightQuery, ProviderOutcome } from '../../journeys/ports.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Far from its departure a flight changes little: it is asked again after 3 hours at most. */
const FAR_MS = 3 * HOUR_MS;
/** Within 3 hours of the departure gates and delays change: it is asked again every 20 minutes. */
const NEAR_MS = 20 * MINUTE_MS;
/** A failure is not asked again sooner, so a watch round every 20 s does not spend units. */
const FAILURE_MS = 5 * MINUTE_MS;

interface Entry {
  readonly outcome: ProviderOutcome<Flight | null>;
  readonly until: number;
}

/**
 * Keeps each answer for a while, the longer the further its departure is. A kept answer is
 * served with its age worked out again, so its provenance says how old it is now.
 */
export function cachedFlights(finder: FlightFinder, clock: Clock): FlightFinder {
  const entries = new Map<string, Entry>();
  return {
    sourceId: finder.sourceId,
    async find(query, signal) {
      const key = keyOf(query);
      const now = clock.now();
      const kept = entries.get(key);
      if (kept !== undefined && kept.until > now.getTime()) return aged(kept.outcome, now);
      const outcome = await finder.find(query, signal);
      const answeredAt = clock.now();
      for (const [other, entry] of entries) {
        if (entry.until <= answeredAt.getTime()) entries.delete(other);
      }
      entries.set(key, { outcome, until: answeredAt.getTime() + keepFor(outcome, answeredAt) });
      return outcome;
    },
  };
}

const keyOf = (query: FlightQuery): string => `${query.carrier}${query.number}/${query.date}`;

/** How long an answer is kept, from the departure it gives. */
export function keepFor(outcome: ProviderOutcome<Flight | null>, now: Date): number {
  if (!outcome.ok) return FAILURE_MS;
  const flight = outcome.value;
  // No such flight, or one that has left: nothing will change soon.
  if (flight?.takeOffAt !== null) return FAR_MS;
  const departure =
    flight.revisedDeparture?.kind === 'revised' ? flight.revisedDeparture.at : flight.departureAt;
  const nearFrom = Date.parse(departure) - FAR_MS;
  return Math.min(FAR_MS, Math.max(NEAR_MS, nearFrom - now.getTime()));
}

function aged(outcome: ProviderOutcome<Flight | null>, now: Date): ProviderOutcome<Flight | null> {
  if (!outcome.ok) return outcome;
  const { dataTime } = outcome.provenance;
  const ageSeconds =
    dataTime === null
      ? null
      : Math.max(0, Math.round((now.getTime() - Date.parse(dataTime)) / 1000));
  const provenance = { ...outcome.provenance, ageSeconds };
  return {
    ok: true,
    value: outcome.value === null ? null : { ...outcome.value, provenance },
    provenance,
  };
}
