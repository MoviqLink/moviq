import { nwsHourlyForecastSource } from '../../data-platform/sources/city/nws-hourly-forecast.js';
import { nycDotTrafficSpeedsSource } from '../../data-platform/sources/city/nyc-dot-traffic-speeds.js';
import { unixSeconds, type ExtractedEvent } from '../events.js';
import { extractorFor, type Extractor } from '../extractor.js';

/** Each day starts with every value, so a day of samples reads on its own. */
const DAILY = { mode: null, restartsDaily: true } as const;

type SampleValue = Readonly<Record<string, number | string | boolean | null>>;

/** Keeps the last value of each key and writes a sample only when it changes. */
function createChangeSampler() {
  const last = new Map<string, string>();
  return (key: string, t: number, value: SampleValue): ExtractedEvent[] => {
    const text = JSON.stringify(value);
    if (last.get(key) === text) return [];
    last.set(key, text);
    return [{ k: 'sample', t, key, value }];
  };
}

/** NYC DOT link speeds: each link when its speed or travel time changes. */
const trafficSpeeds = extractorFor(nycDotTrafficSpeedsSource, DAILY, () => {
  const sample = createChangeSampler();
  return (data) =>
    data.segments.flatMap((segment) =>
      sample(segment.id, unixSeconds(segment.measuredAt), {
        mph: segment.speedMph,
        seconds: segment.travelTimeSeconds,
      }),
    );
});

/** The hourly forecast for Manhattan: each hour when what is forecast for it changes. */
const hourlyForecast = extractorFor(nwsHourlyForecastSource, DAILY, () => {
  const sample = createChangeSampler();
  return (data, context) =>
    data.hours.flatMap((hour) =>
      sample(hour.startsAt, unixSeconds(context.dataTime), {
        temperatureC: hour.temperatureC,
        precipitationChance: hour.precipitationChance,
        windKmhMax: hour.windKmh.max,
        summary: hour.summary,
      }),
    );
});

export const sampleExtractors: readonly Extractor[] = [trafficSpeeds, hourlyForecast];
