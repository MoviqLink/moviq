import { toInstant, type Provenance } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { SourceDefinition } from './definition.js';
import { healthStore } from './health-store.js';
import { assess, NO_FACTS } from './health.js';
import { snapshotStore } from './snapshots.js';

/** The data a source serves now, with where it comes from and how old it is. */
export interface SourceReading<T> {
  /** Undefined when the source has nothing usable: the provenance says why. */
  readonly data: T | undefined;
  /**
   * The version served, which changes only when new data is admitted, so a consumer can keep
   * what it builds from `data` until then. Absent when nothing is served.
   */
  readonly version?: string;
  readonly provenance: Provenance;
}

export interface SourceReader {
  read<T>(definition: SourceDefinition<T>): Promise<SourceReading<T>>;
}

export interface SourceReaderDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly missingVariables: (definition: SourceDefinition) => readonly string[];
}

/** A served copy validated by one definition's schema, kept for the next reads. */
interface Validated<T> {
  readonly definition: SourceDefinition<T>;
  readonly version: string;
  readonly data: T;
}

/**
 * The cached copy is the one this very definition validated, so its data has the definition's
 * type: the identity check stands for the validation already done, not for a cast.
 */
function validatedBy<T>(
  entry: Validated<unknown> | undefined,
  definition: SourceDefinition<T>,
  version: string,
): entry is Validated<T> {
  return entry?.definition === definition && entry.version === version;
}

/**
 * How product modules read the data platform. The state and age are recomputed on every read;
 * the data of each served version is read and validated once, then kept in memory and handed out
 * as it is until another version is served: timetables with their stop times are too large to
 * validate again on every read.
 */
export function createSourceReader(deps: SourceReaderDependencies): SourceReader {
  const cache = new Map<string, Validated<unknown>>();
  return {
    async read<T>(definition: SourceDefinition<T>): Promise<SourceReading<T>> {
      const record = await healthStore.read(deps.db, definition.id);
      const now = deps.clock.now();
      const assessment = assess(
        definition,
        record ?? NO_FACTS,
        now,
        deps.missingVariables(definition),
      );
      const provenance: Provenance = {
        sourceId: definition.id,
        dataTime: record?.dataTime === undefined ? null : toInstant(record.dataTime),
        receivedAt: record?.receivedAt === undefined ? null : toInstant(record.receivedAt),
        ageSeconds: assessment.ageMs === undefined ? null : assessment.ageMs / 1000,
        state: assessment.state,
        evidence: assessment.evidence,
      };
      const version = record?.servedVersion;
      if (version === undefined || assessment.state === 'unavailable')
        return { data: undefined, provenance };
      const cached = cache.get(definition.id);
      if (validatedBy(cached, definition, version)) {
        return { data: cached.data, version, provenance };
      }
      const parsed = definition.dataSchema.safeParse(
        await snapshotStore.read(deps.db, definition.id, version),
      );
      if (!parsed.success)
        return {
          data: undefined,
          provenance: {
            ...provenance,
            state: 'unavailable',
            evidence: 'The stored copy no longer matches its schema.',
          },
        };
      cache.set(definition.id, { definition, version, data: parsed.data });
      return { data: parsed.data, version, provenance };
    },
  };
}
