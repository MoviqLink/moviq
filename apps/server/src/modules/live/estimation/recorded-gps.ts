import type { VehicleMode } from '@moviq/contracts';

import { stretchOf } from '../../recorder/nightly/stretch-speeds.js';
import { AGE_BANDS, ageBand } from '../../recorder/nightly/tracking-errors.js';
import type { ReadingDependencies } from '../../recorder/reading.js';
import { stretchSpeed, trackingErrors, type StretchKey } from '../../recorder/reading-gps.js';
import { bearingDegrees } from '../geo.js';
import { pointAt, type Line } from './line.js';
import { createReadCache, measuredSpan } from './recorded-segments.js';
import { usableMargin, usableSpeed, type RecordedMargin } from './statistics.js';

/** Metres either side of a point of a shape over which its heading is taken. */
const HEADING_SPAN = 15;

/** The stretch the recorder measures `meters` along a shape, with the heading of the shape. */
export function stretchOn(line: Line, meters: number): string {
  const back = pointAt(line, meters - HEADING_SPAN);
  const ahead = pointAt(line, meters + HEADING_SPAN);
  return stretchOf(pointAt(line, meters), bearingDegrees(back, ahead));
}

export const stretchId = (key: StretchKey) =>
  JSON.stringify([key.route, key.stretch, key.band, key.dayType]);

/** The speed of the stretches asked for, read in the background as the segments are. */
export function createStretchCache(deps: ReadingDependencies, onError: (error: unknown) => void) {
  return createReadCache(
    stretchId,
    async (key: StretchKey) => {
      const reading = await stretchSpeed(deps, key);
      const span = measuredSpan(reading);
      if (span === undefined || reading.status !== 'ok') return null;
      return usableSpeed({ ...span, metersPerSecond: reading.value });
    },
    onError,
  );
}

export const marginKey = (route: string, ageFrom: number) => `${route}|${String(ageFrom)}`;

/** The replayed error of each bus route by band of age, with 20 measures or more. */
export async function readMargins(deps: ReadingDependencies) {
  const margins = new Map<string, RecordedMargin>();
  for (const reading of await trackingErrors(deps)) {
    const span = measuredSpan(reading);
    if (span === undefined || reading.status !== 'ok') continue;
    const margin = usableMargin({ ...span, p90Meters: reading.value.p90Meters });
    if (margin !== null) margins.set(marginKey(reading.value.route, reading.value.ageFrom), margin);
  }
  return margins;
}

/**
 * The margin of a `gps-plus` bus `ageSeconds` after its report: the band of that age, or else
 * the first older band measured, whose error is at least as large (a bus drawn longer from its
 * report strays further). Null for other modes, which the recorder does not replay.
 */
export function marginFor(
  margin: (route: string, ageFrom: number) => RecordedMargin | null,
  mode: VehicleMode,
  route: string,
  ageSeconds: number,
): RecordedMargin | null {
  const band = ageBand(ageSeconds);
  if (mode !== 'bus' || band === undefined) return null;
  for (let index = band; index < AGE_BANDS.length; index += 1) {
    const found = margin(route, index === 0 ? 0 : (AGE_BANDS[index - 1] ?? 0));
    if (found !== null) return found;
  }
  return null;
}
