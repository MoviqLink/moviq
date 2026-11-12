import { recorderStatsSource } from '../../data-platform/sources/recorder/moviq-recorder-stats.js';
import { bandOf, dayOf, dayTypeOf } from '../../recorder/nightly/calendar.js';
import type { Finding, HeadwayFact } from './findings.js';
import type { RouteRef } from './lines.js';
import { sourceOf, type CityPorts } from './ports.js';

/** Fewer intervals than this in a direction and band are not a measure worth telling. */
const MIN_HEADWAYS = 20;

/**
 * How a line usually runs at a time, from MovIQ's own recorder (`moviq-recorder-stats`): the
 * intervals between vehicles in each direction (median and 90th percentile), how many came
 * bunched, and the stoppages observed, for the same type of day and band as asked, each with its
 * count and day. Until the recorder has measured enough of it, there is no figure to give.
 */
export async function lineReliability(
  ports: CityPorts,
  route: RouteRef,
  at: Date,
): Promise<Finding> {
  const reading = await ports.reader.read(recorderStatsSource);
  const sources = [sourceOf(recorderStatsSource, reading)];
  const stats = reading.data;
  const band = bandOf(at);
  if (stats === undefined || route.mode === 'path' || stats.dayType !== dayTypeOf(dayOf(at))) {
    return { kind: 'line-reliability', route, measured: null, sources };
  }
  const headways: HeadwayFact[] = stats.headways
    .filter(
      ([mode, line, , rowBand, n]) =>
        mode === route.mode && route.ids.includes(line) && rowBand === band && n >= MIN_HEADWAYS,
    )
    .map(([, , direction, , n, p50Seconds, p90Seconds, , , bunched]) => ({
      direction,
      n,
      p50Seconds,
      p90Seconds,
      bunched,
    }));
  if (headways.length === 0) return { kind: 'line-reliability', route, measured: null, sources };
  const stoppages = stats.stoppages.filter(
    ([mode, line, , , started]) =>
      mode === route.mode && route.ids.includes(line) && bandOf(new Date(started * 1000)) === band,
  ).length;
  return {
    kind: 'line-reliability',
    route,
    measured: { day: stats.day, dayType: stats.dayType, band, headways, stoppages },
    sources,
  };
}
