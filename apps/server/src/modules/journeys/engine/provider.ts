import { toInstant, type Provenance, type SourceState } from '@moviq/contracts';

import type { Clock } from '../../../infrastructure/clock/clock.js';
import type { ProviderOutcome, RoutedItinerary, RoutingProvider } from '../ports.js';
import type {
  EngineSources,
  PredictionReading,
  TimetableInput,
  TimetableReading,
} from './inputs.js';
import { buildOverlay, type LiveOverlay } from './live.js';
import { compileNetwork, networkKey, type Network } from './network.js';
import { planItineraries } from './search.js';
import { searchCalendar } from './service-days.js';
import { stepFreeEvidence, stepFreeRefusal } from './step-free-changes.js';
import { checkedPlan } from './street-check.js';
import type { StreetWalks } from './street-walks.js';

const ENGINE_SOURCE_ID = 'moviq-raptor';

/** Four rides at most: enough for any trip inside the city, and it bounds the search. */
const DEFAULT_MAX_TRANSFERS = 3;

/** Live predictions are used while their source is fresh enough to show as live. */
const LIVE_STATES: ReadonlySet<SourceState> = new Set(['healthy', 'degraded']);

export interface EngineRoutingOptions {
  readonly sources: EngineSources;
  readonly clock: Clock;
  readonly maxTransfers?: number;
  /** The streets the final itineraries' walks are walked on; without them they stay estimated. */
  readonly streets?: StreetWalks;
}

type Failure = Extract<ProviderOutcome<unknown>, { readonly ok: false }>;

function failure(state: Failure['state'], code: string, detail: string): Failure {
  return { ok: false, state, code, detail };
}

interface UsableTimetable {
  readonly sourceId: string;
  readonly version: string;
  readonly provenance: Provenance;
  readonly timetable: TimetableInput;
}

function usable(reading: TimetableReading): UsableTimetable | undefined {
  const { sourceId, version, provenance, timetable } = reading;
  if (version === undefined || timetable === undefined) return undefined;
  return { sourceId, version, provenance, timetable };
}

function missingNote(missing: readonly TimetableReading[]): string {
  if (missing.length === 0) return '';
  const list = missing.map((reading) => `${reading.sourceId} (${reading.provenance.state})`);
  return `; without ${list.join(', ')}`;
}

function worstState(states: readonly SourceState[], incomplete: boolean): SourceState {
  if (states.includes('stale')) return 'stale';
  if (incomplete || states.some((state) => state !== 'healthy')) return 'degraded';
  return 'healthy';
}

function oldest(provenances: readonly Provenance[]): string | null {
  const times = provenances.flatMap((provenance) => provenance.dataTime ?? []);
  return times.length === 0 ? null : ([...times].sort()[0] ?? null);
}

interface Evidence {
  readonly network: Network;
  readonly missing: readonly TimetableReading[];
  readonly live: readonly PredictionReading[];
  readonly skipped: readonly PredictionReading[];
  readonly overlay: LiveOverlay;
  readonly itineraries: number;
  readonly deadline: Date;
  /** What a step-free answer leaves out and does not verify, or empty. */
  readonly stepFree: string;
  /** How the walks are known, as `checkedPlan` says it. */
  readonly walks: string;
}

function evidenceOf(input: Evidence): string {
  const timetables = input.network.feeds
    .map((feed) => `${feed.sourceId}@${feed.version} (${feed.provenance.state})`)
    .join(', ');
  const live =
    input.live.length === 0
      ? 'no live predictions'
      : `live ${input.live.map((reading) => reading.sourceId).join(', ')}: ` +
        `${String(input.overlay.counts.live)} trips predicted, ${String(input.overlay.counts.cancelled)} cancelled`;
  const notUsed = input.skipped.map(
    (reading) => `${reading.sourceId} (${reading.provenance.state})`,
  );
  const skipped = notUsed.length === 0 ? '' : `; live not used: ${notUsed.join(', ')}`;
  const leftOut = [...input.network.leftOut].map(([reason, count]) => `${String(count)} ${reason}`);
  const left = leftOut.length === 0 ? '' : `; left out of the network: ${leftOut.join(', ')}`;
  return (
    `MovIQ engine (RAPTOR, arrive by) planned ${String(input.itineraries)} itineraries arriving by ` +
    `${toInstant(input.deadline)} on ${timetables}${missingNote(input.missing)}${left}; ` +
    `${live}${skipped}${input.stepFree}${input.walks}.`
  );
}

function provenanceOf(input: Evidence, now: Date): Provenance {
  const used = [
    ...input.network.feeds.map((feed) => feed.provenance),
    ...input.live.map((reading) => reading.provenance),
  ];
  const dataTime = oldest(used);
  return {
    sourceId: ENGINE_SOURCE_ID,
    dataTime,
    receivedAt: toInstant(now),
    ageSeconds:
      dataTime === null
        ? null
        : Math.max(0, Math.round((now.getTime() - Date.parse(dataTime)) / 1000)),
    state: worstState(
      used.map((provenance) => provenance.state),
      input.missing.length > 0,
    ),
    evidence: evidenceOf(input),
  };
}

/** The live readings fresh enough to use, and the others, named in the evidence. */
function splitLive(readings: readonly PredictionReading[]): {
  readonly live: readonly PredictionReading[];
  readonly skipped: readonly PredictionReading[];
} {
  const fresh = (reading: PredictionReading): boolean =>
    reading.predictions !== undefined && LIVE_STATES.has(reading.provenance.state);
  return { live: readings.filter(fresh), skipped: readings.filter((reading) => !fresh(reading)) };
}

const CANCELLED = failure('unavailable', 'cancelled', 'The plan was cancelled.');

/** Read through a call, so the check after each await is not narrowed away. */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * MovIQ's own routing: RAPTOR backwards over the MTA timetables served by the data platform,
 * with live predictions in place of the timetable where the feeds have them. The network is
 * compiled once per set of timetable versions and kept until one of them changes.
 */
export function createEngineRouting(options: EngineRoutingOptions): RoutingProvider {
  let network: Network | undefined;
  const maxTransfers = options.maxTransfers ?? DEFAULT_MAX_TRANSFERS;
  const networkFor = (feeds: readonly UsableTimetable[]): Network => {
    const sorted = [...feeds].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));
    if (network?.key !== networkKey(sorted)) network = compileNetwork(sorted);
    return network;
  };
  return {
    sourceId: ENGINE_SOURCE_ID,
    async plan(query, signal): Promise<ProviderOutcome<readonly RoutedItinerary[]>> {
      const now = options.clock.now();
      const window = { from: now, to: query.arriveBy };
      const readings = await options.sources.readTimetables(window, signal);
      if (aborted(signal)) return CANCELLED;
      const feeds = readings.flatMap((reading) => usable(reading) ?? []);
      const missing = readings.filter((reading) => usable(reading) === undefined);
      if (feeds.length === 0) {
        return failure(
          'unavailable',
          'no-timetable',
          `No timetable is available to plan with${missingNote(missing)}.`,
        );
      }
      const compiled = networkFor(feeds);
      const refusal = query.stepFree ? stepFreeRefusal(compiled, query) : undefined;
      if (refusal !== undefined) return failure('unavailable', 'no-step-free-data', refusal);
      const calendar = searchCalendar(compiled.services, query.arriveBy);
      if (calendar === undefined) {
        return failure(
          'unavailable',
          'no-service-day',
          'The arrival time has no New York service day.',
        );
      }
      const predictions = await options.sources.readPredictions(signal);
      if (aborted(signal)) return CANCELLED;
      const { live, skipped } = splitLive(predictions);
      const overlay = buildOverlay(
        compiled,
        calendar,
        live.flatMap((reading) => reading.predictions ?? []),
      );
      const input = { network: compiled, calendar, overlay, query, now, maxTransfers };
      const checked = await checkedPlan((known) => planItineraries(input, known), {
        streets: options.streets,
        query,
        now,
        stops: compiled.stops.lat.length,
        signal,
      });
      if (aborted(signal)) return CANCELLED;
      const { itineraries, noWay } = checked;
      if (itineraries.length === 0) {
        return failure(
          'unavailable',
          noWay === null ? 'no-itineraries' : 'no-street-way',
          `No itinerary on the timetables served leaves after ${toInstant(now)} and arrives by ` +
            `${toInstant(query.arriveBy)}${missingNote(missing)}${noWay === null ? '' : `: ${noWay}`}.`,
        );
      }
      const evidence = {
        network: compiled,
        missing,
        live,
        skipped,
        overlay,
        itineraries: itineraries.length,
        deadline: query.arriveBy,
        stepFree: stepFreeEvidence(compiled, query, itineraries),
        walks: checked.evidence,
      };
      return { ok: true, value: itineraries, provenance: provenanceOf(evidence, now) };
    },
  };
}
