import {
  liveModeSchema,
  toInstant,
  type ExclusionReason,
  type LiveMode,
  type LiveSource,
  type LiveStation,
  type LiveVehicle,
  type ModeStatus,
  type ModeSummary,
} from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { SourceReader } from '../data-platform/reader.js';
import type { PositionEstimator } from './estimate.js';
import { createPositionEstimator } from './estimation/estimator.js';
import type { LiveModeFeed, ModeReading } from './feeds/feed.js';
import { defaultFeeds } from './feeds/index.js';
import { createTimetables } from './timetable.js';
import { selectedRoute } from './selected-route.js';
import { lineDirectory } from './line-directory.js';

/** The whole city now: every mode, followed or not, with the sources behind it. */
export interface CitySnapshot {
  readonly generatedAt: string;
  readonly modes: readonly ModeSummary[];
  readonly vehicles: readonly LiveVehicle[];
  readonly stations: readonly LiveStation[];
  readonly sources: readonly LiveSource[];
}

export interface LiveCityDependencies {
  readonly reader: SourceReader;
  readonly clock: Clock;
  /** One feed per source of a mode; `defaultFeeds()` when absent. */
  readonly feeds?: readonly LiveModeFeed[];
  /**
   * Where each vehicle is drawn; by default the estimator of `estimation/` before the recorder
   * has measured anything, so with no margin.
   */
  readonly estimate?: PositionEstimator;
}

/**
 * Sources are read at most this often for every screen together; the fastest of them is read by
 * the platform every 30 seconds, so a screen never waits for anything newer.
 */
export const SNAPSHOT_MS = 5_000;

function statusOf(reading: ModeReading): ModeStatus {
  const live = reading.sources.filter((source) =>
    reading.liveSourceIds.includes(source.provenance.sourceId),
  );
  const usable = live.some(
    (source) => source.provenance.state !== 'unavailable' && source.provenance.dataTime !== null,
  );
  if (!usable) return 'unavailable';
  const allHealthy = reading.sources.every((source) => source.provenance.state === 'healthy');
  return allHealthy ? 'live' : 'degraded';
}

function summaryOf(mode: LiveMode, reading: ModeReading | undefined): ModeSummary {
  if (reading === undefined) {
    return { mode, status: 'not-connected', shown: 0, excluded: [], sourceIds: [] };
  }
  return {
    mode,
    status: statusOf(reading),
    shown: reading.vehicles.length + reading.stations.length,
    excluded: [...reading.excluded].map(([reason, count]) => ({ reason, count })),
    sourceIds: reading.sources.map((source) => source.provenance.sourceId),
  };
}

function uniqueSources(readings: readonly ModeReading[]): LiveSource[] {
  const byId = new Map<string, LiveSource>();
  for (const source of readings.flatMap((reading) => reading.sources)) {
    byId.set(source.provenance.sourceId, source);
  }
  return [...byId.values()];
}

/** The readings of every source of one mode, as one: a mode is shown from all its sources. */
function merged(readings: readonly ModeReading[]): ModeReading {
  const excluded = new Map<ExclusionReason, number>();
  for (const [reason, count] of readings.flatMap((reading) => [...reading.excluded])) {
    excluded.set(reason, (excluded.get(reason) ?? 0) + count);
  }
  return {
    vehicles: readings.flatMap((reading) => reading.vehicles),
    stations: readings.flatMap((reading) => reading.stations),
    excluded,
    sources: uniqueSources(readings),
    liveSourceIds: [...new Set(readings.flatMap((reading) => reading.liveSourceIds))],
  };
}

interface CityParts {
  readonly reader: SourceReader;
  readonly clock: Clock;
  readonly feeds: readonly LiveModeFeed[];
  readonly estimate: PositionEstimator;
  readonly timetables: ReturnType<typeof createTimetables>;
}

async function buildSnapshot(parts: CityParts): Promise<CitySnapshot> {
  const now = parts.clock.now();
  const context = {
    reader: parts.reader,
    now,
    timetables: await parts.timetables.current(),
    estimate: parts.estimate,
  };
  const readings = await Promise.all(parts.feeds.map((feed) => feed.read(context)));
  const ofMode = (mode: LiveMode) =>
    readings.filter((_, index) => parts.feeds[index]?.mode === mode);
  return {
    generatedAt: toInstant(now),
    modes: liveModeSchema.options.map((mode) => {
      const own = ofMode(mode);
      return summaryOf(mode, own.length === 0 ? undefined : merged(own));
    }),
    vehicles: readings.flatMap((reading) => reading.vehicles),
    stations: readings.flatMap((reading) => reading.stations),
    sources: uniqueSources(readings),
  };
}

/**
 * One snapshot of the city shared by every screen, built again at most every 5 seconds. Each
 * build moves the estimator on, so it follows only what is built: `keepCityWarm` builds it while
 * nobody looks.
 */
export function createLiveCity(deps: LiveCityDependencies) {
  const parts: CityParts = {
    reader: deps.reader,
    clock: deps.clock,
    feeds: deps.feeds ?? defaultFeeds(),
    estimate: deps.estimate ?? createPositionEstimator(),
    timetables: createTimetables(deps.reader, deps.clock),
  };
  let cached: { readonly at: number; readonly value: Promise<CitySnapshot> } | undefined;
  return {
    feeds: parts.feeds,
    async lines() {
      const [snapshot, tables] = await Promise.all([this.snapshot(), parts.timetables.current()]);
      return {
        generatedAt: snapshot.generatedAt,
        modes: [...snapshot.modes],
        sources: [...snapshot.sources],
        lines: await lineDirectory(snapshot.vehicles, tables, parts.reader),
      };
    },
    async routeDetails(vehicle: LiveVehicle) {
      return selectedRoute(vehicle, parts.reader, await parts.timetables.current());
    },
    async route(vehicle: LiveVehicle) {
      return (await selectedRoute(vehicle, parts.reader, await parts.timetables.current()))
        .coordinates;
    },
    snapshot(): Promise<CitySnapshot> {
      const now = deps.clock.now().getTime();
      if (cached === undefined || now - cached.at >= SNAPSHOT_MS) {
        const value = buildSnapshot(parts);
        cached = { at: now, value };
        value.catch(() => {
          if (cached?.value === value) cached = undefined;
        });
      }
      return cached.value;
    },
  };
}

export type LiveCity = ReturnType<typeof createLiveCity>;
