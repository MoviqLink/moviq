import type { SourceDefinition } from '../../server/src/modules/data-platform/definition.js';
import { adsbLolSource } from '../../server/src/modules/data-platform/sources/air/adsb-lol.js';
import { amtrakerSource } from '../../server/src/modules/data-platform/sources/amtrak/amtraker.js';
import { citiBikeStatusSource } from '../../server/src/modules/data-platform/sources/bikes/citi-bike.js';
import { faaAirportStatusSource } from '../../server/src/modules/data-platform/sources/city/faa-airport-status.js';
import { nwsAlertsSource } from '../../server/src/modules/data-platform/sources/city/nws-alerts.js';
import { nwsHourlyForecastSource } from '../../server/src/modules/data-platform/sources/city/nws-hourly-forecast.js';
import { citySources } from '../../server/src/modules/data-platform/sources/city/index.js';
import { nyWaterwayRealtimeSources } from '../../server/src/modules/data-platform/sources/ferries/ny-waterway.js';
import { nycFerryRealtimeSources } from '../../server/src/modules/data-platform/sources/ferries/nyc-ferry-realtime.js';
import { fleetSources } from '../../server/src/modules/data-platform/sources/micromobility/operators.js';
import { mtaAlerts } from '../../server/src/modules/data-platform/sources/mta/alerts.js';
import { busSources } from '../../server/src/modules/data-platform/sources/mta/bus-realtime.js';
import { mtaElevators } from '../../server/src/modules/data-platform/sources/mta/elevators.js';
import { subwaySources } from '../../server/src/modules/data-platform/sources/mta/subway-realtime.js';
import { railRealtimeSources } from '../../server/src/modules/data-platform/sources/regional/rail-realtime.js';
import { openWatersSource } from '../../server/src/modules/data-platform/sources/sea/open-waters.js';
import { airportShuttleSources } from '../../server/src/modules/data-platform/sources/shuttles/passio-airports.js';
import { passioGoSource } from '../../server/src/modules/data-platform/sources/shuttles/passio-go.js';
import { beeLineSources } from '../../server/src/modules/data-platform/sources/westchester/bee-line.js';
import type { Extractor } from '../../server/src/modules/recorder/extractor.js';
import type { SplitBy } from './gtfs-rt/split.js';
import { recorderExtractors } from '../../server/src/modules/recorder/extractors/index.js';

/**
 * What the recorder downloads itself, how often, and in how many parts. A part is the work of
 * one alarm: GTFS Realtime feeds too large for the CPU of one alarm are split into stable parts,
 * by entity id or by trip id, each a valid feed of its own, so every vehicle or trip always falls
 * in the same part and the extractor of that part sees all of its history. `cost` predicts the
 * CPU of a part from its size; `tools/cpu-budget.ts` measures every part of real answers and
 * fails when one takes more than predicted.
 */
export interface RecordedSource {
  readonly definition: SourceDefinition;
  readonly extractor: Extractor;
  readonly everyMs: number;
  readonly parts: number;
  readonly splitBy: SplitBy;
  readonly cost: Cost;
}

/** CPU of one part: a fixed part and a part for each KiB of the answer. */
interface Cost {
  readonly baseMs: number;
  readonly msPerKib: number;
}

/**
 * The CPU one alarm may spend on parts by their predicted costs, which carry a margin of their
 * own, under the 10 ms of the free plan.
 */
export const BUDGET_MS = 9;

export const costOf = (source: RecordedSource, bytes: number): number =>
  source.cost.baseMs + (source.cost.msPerKib * bytes) / 1024;

/** Sources left out, with the measure that keeps them out of the free plan. */
export interface LeftOutSource {
  readonly sourceId: string;
  readonly why: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

interface Plan {
  readonly everyMs: number;
  readonly parts?: number;
  readonly splitBy?: SplitBy;
  readonly cost: Cost;
}

const [busPositions, busTripUpdates] = busSources;
const [nycFerryPositions] = nycFerryRealtimeSources;
const [, beeLinePositions] = beeLineSources;
const LIME_ID = 'lime-new-york';
const VEO_IDS: ReadonlySet<string> = new Set(['veo-bronx', 'veo-queens']);
const otherFleets = fleetSources.filter(
  (definition) => definition.id !== LIME_ID && !VEO_IDS.has(definition.id),
);

/**
 * Each subway feed: its parts, by trip, as its updates and trains join, and its CPU per KiB,
 * measured on 11/11/2026 at 23:00 in New York with a margin of a third; the parts leave room for
 * busier hours. NQRW and 1234567 were raised on 11/11 at 15:20 in Barcelona, when the guard
 * measured them over their cost with the Mac under load: a prediction must hold on a busy machine.
 */
const SUBWAY: Readonly<Record<string, { readonly parts: number; readonly msPerKib: number }>> = {
  'mta-subway-ace': { parts: 5, msPerKib: 0.3 },
  'mta-subway-bdfm': { parts: 3, msPerKib: 0.19 },
  'mta-subway-nqrw': { parts: 2, msPerKib: 0.13 },
  'mta-subway-1234567': { parts: 4, msPerKib: 0.22 },
  'mta-subway-l': { parts: 1, msPerKib: 0.18 },
  'mta-subway-jz': { parts: 1, msPerKib: 0.11 },
  'mta-subway-g': { parts: 1, msPerKib: 0.16 },
  'mta-subway-sir': { parts: 1, msPerKib: 0.1 },
};

/** What a part costs before its size: the fingerprint, the session and the gzip member. */
const BASE_MS = 0.5;

const cost = (baseMs: number, msPerKib: number): Cost => ({ baseMs, msPerKib });

/** A source of the city catalogue by its id. */
function cityDefinition(id: string): SourceDefinition {
  const definition = citySources.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`No city source ${id}.`);
  return definition;
}

/**
 * The cadences: 30 s for the subway, whose arrivals are seen while a train reports itself
 * stopped, and for rail, ferries and shuttles; 60 s for Bus Time positions, which keeps a
 * passage inside the 90 s window that times it and halves the CPU of the largest feed of the
 * city; 10 minutes for Bus Time predictions, the most expensive to read (2.3 MB at 20:05); the
 * rhythm of each provider for the rest, never faster than it updates.
 */
const PLANS: readonly (readonly [SourceDefinition, Plan])[] = [
  ...subwaySources.map(
    (definition) =>
      [
        definition,
        {
          everyMs: 30 * SECOND,
          parts: SUBWAY[definition.id]?.parts ?? 1,
          splitBy: 'trip',
          cost: cost(BASE_MS, SUBWAY[definition.id]?.msPerKib ?? 0.3),
        },
      ] as const,
  ),
  // Raised from 0.15 on 11/11 at 15:20, measured at 0.168 with the Mac under load.
  [busPositions, { everyMs: MINUTE, parts: 12, cost: cost(BASE_MS, 0.18) }],
  [busTripUpdates, { everyMs: 10 * MINUTE, parts: 64, cost: cost(BASE_MS, 0.22) }],
  [mtaAlerts, { everyMs: 2 * MINUTE, parts: 4, cost: cost(BASE_MS, 0.025) }],
  [mtaElevators, { everyMs: 2 * MINUTE, cost: cost(BASE_MS, 0.065) }],
  ...railRealtimeSources.map(
    (definition) =>
      [
        definition,
        { everyMs: 30 * SECOND, parts: 3, splitBy: 'trip', cost: cost(BASE_MS, 0.14) },
      ] as const,
  ),
  [nycFerryPositions, { everyMs: 30 * SECOND, cost: cost(BASE_MS, 0.2) }],
  ...nyWaterwayRealtimeSources.map(
    (definition) => [definition, { everyMs: 30 * SECOND, cost: cost(BASE_MS, 0.2) }] as const,
  ),
  [beeLinePositions, { everyMs: 30 * SECOND, cost: cost(BASE_MS, 0.2) }],
  ...airportShuttleSources.map(
    (definition) => [definition, { everyMs: 30 * SECOND, cost: cost(BASE_MS, 0.2) }] as const,
  ),
  [passioGoSource, { everyMs: MINUTE, cost: cost(BASE_MS, 0.2) }],
  [amtrakerSource, { everyMs: 2 * MINUTE, cost: cost(BASE_MS, 0.005) }],
  [adsbLolSource, { everyMs: 5 * MINUTE, cost: cost(BASE_MS, 0.02) }],
  [openWatersSource, { everyMs: 2 * MINUTE, cost: cost(BASE_MS, 0.02) }],
  ...otherFleets.map(
    (definition) => [definition, { everyMs: 5 * MINUTE, cost: cost(BASE_MS, 0.02) }] as const,
  ),
  [faaAirportStatusSource, { everyMs: MINUTE, cost: cost(BASE_MS, 0.2) }],
  [nwsAlertsSource, { everyMs: 2 * MINUTE, cost: cost(BASE_MS, 0.2) }],
  [nwsHourlyForecastSource, { everyMs: 15 * MINUTE, cost: cost(BASE_MS, 0.015) }],
  [cityDefinition('nyc-dot-traffic-speeds'), { everyMs: 5 * MINUTE, cost: cost(BASE_MS, 0.02) }],
];

function extractorOf(sourceId: string): Extractor {
  const extractor = recorderExtractors.find((candidate) => candidate.sourceId === sourceId);
  if (extractor === undefined) throw new Error(`No extractor reads ${sourceId}.`);
  return extractor;
}

export const recordedSources: readonly RecordedSource[] = PLANS.map(([definition, plan]) => ({
  definition,
  extractor: extractorOf(definition.id),
  everyMs: plan.everyMs,
  parts: plan.parts ?? 1,
  splitBy: plan.splitBy ?? 'entity',
  cost: plan.cost,
}));

/**
 * Measured on 11/11/2026 with `tools/cpu-budget.ts` (Node, Zod without JIT as in Workers), the
 * whole alarm of one answer, median of five over several runs: Lime (1.2 MB of GBFS JSON, 5,318
 * vehicles) 16 to 23 ms, Citi Bike (1.1 MB, 2,519 stations) 15 to 19 ms, Veo (450 KB in the
 * Bronx and in Queens) 3 to 9 ms from one run to the next, too close to the 10 ms of one alarm
 * of the free plan. JSON cannot be split before it is parsed. adsb.fi is the backup of adsb.lol
 * and would record the same aircraft twice.
 */
export const leftOutSources: readonly LeftOutSource[] = [
  {
    sourceId: LIME_ID,
    why: 'One answer takes 16 to 23 ms of CPU; an alarm of the free plan has 10 ms.',
  },
  {
    sourceId: citiBikeStatusSource.id,
    why: 'One answer takes 15 to 19 ms of CPU; an alarm of the free plan has 10 ms.',
  },
  ...[...VEO_IDS].map((sourceId) => ({
    sourceId,
    why: 'One answer takes 3 to 9 ms of CPU from one run to the next; an alarm has 10 ms.',
  })),
  { sourceId: 'adsb-fi-new-york', why: 'Backup of adsb-lol-new-york: the same aircraft twice.' },
];
