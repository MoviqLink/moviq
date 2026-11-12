import type { CitySource, Journey } from '@moviq/contracts';

import type { Database } from '../../../infrastructure/database/database.js';
import type { SourceDefinition } from '../../data-platform/definition.js';
import type { SourceReader, SourceReading } from '../../data-platform/reader.js';
import { journeyStore } from '../../journeys/journey-store.js';
import type { LiveCity } from '../../live/city.js';

/**
 * What Sara reads to answer about the city: the data platform through its reader, the city
 * Explore shows (vehicles with their position and its basis), and the traveller's watched trip.
 * Nothing here calls a provider.
 */
export interface CityPorts {
  readonly reader: SourceReader;
  readonly live: Pick<LiveCity, 'snapshot'>;
  readonly db: Database;
}

/** A source as Sara cites it: its title, the time of its data and its state when read. */
export function sourceOf(
  definition: SourceDefinition,
  reading: SourceReading<unknown>,
): CitySource {
  return {
    sourceId: definition.id,
    title: definition.title,
    dataTime: reading.provenance.dataTime,
    ageSeconds: reading.provenance.ageSeconds,
    state: reading.provenance.state,
  };
}

/**
 * Data recent enough to say "nothing in force": a stale or missing copy can still show what it
 * holds, never that nothing is happening.
 */
export function current(reading: SourceReading<unknown>): boolean {
  const { state } = reading.provenance;
  return reading.data !== undefined && (state === 'healthy' || state === 'degraded');
}

/** The traveller's newest trip under watch, or undefined when none is. */
export async function watchedJourney(
  db: Database,
  travellerId: string,
): Promise<Journey | undefined> {
  const watched = await journeyStore.watching(db);
  return watched.filter((stored) => stored.travellerId === travellerId).at(-1)?.journey;
}
