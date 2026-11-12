import type { SourceDefinition } from '../data-platform/definition.js';
import type { ExtractedEvent } from './events.js';

/** The kind of vehicle whose trips a source describes, so trips of two modes never mix. */
export type RecorderMode = 'subway' | 'bus';

export interface VersionContext {
  readonly version: string;
  readonly dataTime: Date;
  /** The data time of the version recorded before this one of the same source, if any. */
  readonly previousDataTime: Date | undefined;
}

/** The incidents of a source still open in the registry, with the fingerprint last recorded. */
export type OpenIncidents = ReadonlyMap<
  string,
  { readonly fingerprint: string; readonly since: number }
>;

type Extraction =
  | { readonly ok: true; readonly events: readonly ExtractedEvent[] }
  | { readonly ok: false; readonly why: string };

/** The state an extractor keeps between versions of one source, for one New York day. */
export interface ExtractorSession {
  extract(data: unknown, context: VersionContext): Extraction;
}

/**
 * Turns versions of one source into compact events. A session starts after every restart and,
 * unless the extractor says otherwise, every New York day, so each day of the recording can be
 * read on its own.
 */
export interface Extractor {
  readonly sourceId: string;
  readonly mode: RecorderMode | null;
  /** False for incidents, whose life spans days and carries on from the registry. */
  readonly restartsDaily: boolean;
  start(open: OpenIncidents): ExtractorSession;
}

interface ExtractorOptions {
  readonly mode: RecorderMode | null;
  readonly restartsDaily: boolean;
}

type Extract<T> = (data: T, context: VersionContext) => readonly ExtractedEvent[];

/**
 * Binds an extractor to a source definition: the stored copy is validated with the schema of
 * the source before the extractor sees it, so a copy that no longer matches becomes a gap.
 */
export function extractorFor<T>(
  definition: SourceDefinition<T>,
  options: ExtractorOptions,
  create: (open: OpenIncidents) => Extract<T>,
): Extractor {
  return {
    sourceId: definition.id,
    ...options,
    start(open) {
      const extract = create(open);
      return {
        extract(data, context) {
          const parsed = definition.dataSchema.safeParse(data);
          if (!parsed.success)
            return {
              ok: false,
              why: 'The stored copy no longer matches the schema of its source.',
            };
          return { ok: true, events: extract(parsed.data, context) };
        },
      };
    },
  };
}
