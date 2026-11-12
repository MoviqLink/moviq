import type { LiveLinesResponse, LiveMode, ModeStatus, SourceState } from '@moviq/contracts';

/**
 * Shown before any choice: every train, ferry and shuttle followed now, and the PATH stations with
 * their next trains. Buses, over two thousand at once, are added route by route.
 */
export const CITY_MODES: readonly LiveMode[] = [
  'subway',
  'rail',
  'ferry',
  'shuttle',
  'rail-station',
];

/** The cards of the city now, in this order; buses are counted but drawn only by route. */
const CARD_MODES: readonly LiveMode[] = [
  'subway',
  'bus',
  'rail',
  'ferry',
  'shuttle',
  'rail-station',
];

/** Source states whose data is not shown: a line or mode read from them has nothing reliable. */
export const UNAVAILABLE_STATES: readonly SourceState[] = [
  'unavailable',
  'unknown',
  'stale',
  'rate_limited',
  'misconfigured',
  'outside_service',
];

export interface CityNowCard {
  readonly mode: LiveMode;
  readonly status: ModeStatus;
  /** Followed in the whole city now, as the server counts them. */
  readonly shown: number;
  /** Seconds since the oldest usable live source of the mode was read by its provider. */
  readonly ageSeconds: number | null;
  /** True when the mode is on the map now; false for buses, added by route. */
  readonly onMap: boolean;
}

/** One card per mode of the city now, from the line catalogue, with the age of its live data. */
export function cityNow(catalog: LiveLinesResponse, now: number): CityNowCard[] {
  return CARD_MODES.flatMap((mode) => {
    const summary = catalog.modes.find((item) => item.mode === mode);
    if (summary === undefined) return [];
    const times = catalog.sources
      .filter(
        (source) =>
          source.kind === 'realtime' &&
          summary.sourceIds.includes(source.provenance.sourceId) &&
          !UNAVAILABLE_STATES.includes(source.provenance.state),
      )
      .flatMap((source) =>
        source.provenance.dataTime === null ? [] : [Date.parse(source.provenance.dataTime)],
      );
    return [
      {
        mode,
        status: summary.status,
        shown: summary.shown,
        ageSeconds: times.length === 0 ? null : Math.max(0, (now - Math.min(...times)) / 1000),
        onMap: CITY_MODES.includes(mode),
      },
    ];
  });
}
