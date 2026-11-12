import type { VehicleMode } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import { amtrakerSource } from '../../data-platform/sources/amtrak/amtraker.js';
import { nyWaterwayRealtimeSources } from '../../data-platform/sources/ferries/ny-waterway.js';
import { beeLineSources } from '../../data-platform/sources/westchester/bee-line.js';
import { liveSource } from '../sources.js';
import { createTally, type LiveModeFeed } from './feed.js';

/** A source of vehicles on lines whose reports carry a time but no predicted stop times. */
interface Untimed<T> {
  readonly mode: VehicleMode;
  readonly source: SourceDefinition<T>;
  readonly reports: (data: T) => readonly { readonly observedAt: string }[];
  /** Trips the source lists before a vehicle runs them. */
  readonly waiting?: (data: T) => number;
}

/**
 * Vehicles on a line are shown only with their timed stops, and these sources publish where each
 * one is but no time at any stop: none is drawn. Each is counted, `stale-position` when its
 * report is too old and `no-predictions` otherwise, and the source is cited with its state, so
 * the panel says how many run and why they are not on the map.
 */
function createUntimedFeed<T>(untimed: Untimed<T>): LiveModeFeed {
  const { source } = untimed;
  return {
    mode: untimed.mode,
    interestSourceIds: [source.id],
    async read(context) {
      const reading = await context.reader.read(source);
      const tally = createTally();
      const { data } = reading;
      for (const report of data === undefined ? [] : untimed.reports(data)) {
        const age = context.now.getTime() - Date.parse(report.observedAt);
        tally.add(age > source.freshness.staleAfterMs ? 'stale-position' : 'no-predictions');
      }
      tally.add('not-departed', data === undefined ? 0 : (untimed.waiting?.(data) ?? 0));
      return {
        vehicles: [],
        stations: [],
        excluded: tally.counts,
        sources: [liveSource(source, reading)],
        liveSourceIds: [source.id],
      };
    },
  };
}

/** Westchester's Bee-Line buses: GPS positions, no predictions. */
export const createBeeLineFeed = (): LiveModeFeed =>
  createUntimedFeed({ mode: 'bus', source: beeLineSources[1], reports: (data) => data.buses });

/** NY Waterway boats: GPS positions, no predictions. */
export const createNyWaterwayFeed = (): LiveModeFeed =>
  createUntimedFeed({
    mode: 'ferry',
    source: nyWaterwayRealtimeSources[0],
    reports: (data) => data.vessels,
  });

/** Amtrak trains around Penn Station, by Amtraker: GPS and next station, no stop times. */
export const createAmtrakFeed = (): LiveModeFeed =>
  createUntimedFeed({
    mode: 'rail',
    source: amtrakerSource,
    reports: (data) => data.trains,
    waiting: (data) => data.notDeparted,
  });
