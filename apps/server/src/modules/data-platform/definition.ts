import type { ProductFeature, SourceState } from '@moviq/contracts';
import type { z } from 'zod';

import type { IntegrationId } from '../../config/integrations.js';

/**
 * How often a source is collected:
 * - `cold`: daily or weekly (timetables, stops, toilets);
 * - `warm`: always, every few minutes (alerts, elevators, airports, weather);
 * - `hot`: fast while something is interested in it (vehicle positions, arrivals).
 */
type RhythmClass = 'cold' | 'warm' | 'hot';

export interface Licence {
  readonly name: string;
  readonly url: string;
  /** The credit shown wherever the data appears. */
  readonly attribution: string;
}

/** A failure seen before, with how it is detected, the state it leads to and what happens next. */
export interface KnownFailure {
  readonly code: string;
  readonly detection: string;
  readonly state: SourceState;
  readonly remedy: string;
}

interface RequestContext {
  /** Revealed values of the source's integration credentials, for building the request only. */
  readonly credentials: Readonly<Record<string, string>>;
  readonly now: Date;
}

interface SourceRequest {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Normalised data with the time the provider produced it, or why the candidate is refused. */
export type ParseResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      /** The time of the data itself (feed timestamp, publication date), not of the download. */
      readonly dataTime: Date;
      /** A short count for operators, such as "3,412 vehicles" or "496 stops". */
      readonly coverage: string;
    }
  | { readonly ok: false; readonly code: string; readonly detail: string };

export interface ParseContext<T> {
  readonly receivedAt: Date;
  /** The data currently served, to compare coverage and order with. */
  readonly previous: T | undefined;
}

/**
 * Everything the platform needs to collect, validate, serve and explain one source. Each source
 * is one module exporting one definition; no product code calls a provider directly.
 */
// Methods, not function properties, so definitions of different data fit in one catalogue.
export interface SourceDefinition<T = unknown> {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly licence: Licence;
  readonly kind: 'static' | 'realtime';
  readonly rhythm: {
    readonly class: RhythmClass;
    /** Interval when nothing is interested in the source. */
    readonly baseIntervalMs: number;
    /** Interval while an interest is active; never faster than the provider updates. */
    readonly interestIntervalMs?: number;
  };
  /** Age of the data (by `dataTime`) beyond which it is degraded, stale and unavailable. */
  readonly freshness: {
    readonly degradedAfterMs: number;
    readonly staleAfterMs: number;
    readonly unavailableAfterMs: number;
  };
  readonly limits: { readonly timeoutMs: number; readonly maxBytes: number };
  /**
   * Where `dataTime` comes from. `provider` (the default): the provider dates its data.
   * `receipt`: the provider gives no time, so the time of receipt stands in; freshness then
   * proves only that the feed answered, not that the data was updated, and the evidence says so.
   */
  readonly dataTimeSource?: 'provider' | 'receipt';
  /** The credential this source needs. Without it the source is `misconfigured`. */
  readonly integration?: IntegrationId;
  /** False while the provider publishes nothing, which is not a failure. */
  servicePeriod?(now: Date): boolean;
  /** How many admitted versions to keep: 1 for real-time data, a few for timetables. */
  readonly keepVersions: number;
  /**
   * The schema of the normalised data. Data is stored as JSON and read back through this schema,
   * so it must be plain JSON: instants as ISO strings (`toInstant`), no Date, Map or Set.
   */
  readonly dataSchema: z.ZodType<T>;
  request(context: RequestContext): SourceRequest;
  /** Older stored formats may require the full body rather than a 304. */
  needsFullRefresh?(previous: T): boolean;
  /** Validates the format and normalises. Never throws for bad input: it returns a refusal. */
  parse(body: Uint8Array, context: ParseContext<T>): ParseResult<T>;
  /** Integrity and coverage checks against the data served. Each string is a reason to refuse. */
  check?(data: T, previous: T | undefined): readonly string[];
  /** Product features that read this source, shown to operators. */
  readonly consumers: readonly ProductFeature[];
  /** Another source that can stand in while this one is down. */
  readonly fallback?: string;
  readonly failures: readonly KnownFailure[];
}
