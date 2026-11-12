import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { NWS_LICENCE } from './nws-licence.js';
import { decodeJson, describeIssue, olderThanServed, refuse, type Refusal } from './parsing.js';

/**
 * Bryant Park, Midtown Manhattan. `/points/40.7549,-73.984` answered on 11/11/2026 with office
 * OKX, grid cell 34,44, zone NYZ072 and `forecastHourly` at the URL below; `units=si` asks for
 * Celsius and km/h. A point resolves to its cell once, so the URL is fixed here.
 */
const FORECAST_POINT = {
  name: 'Midtown Manhattan (Bryant Park)',
  latitude: 40.7549,
  longitude: -73.984,
  gridpoint: 'OKX/34,44',
} as const;

const FORECAST_URL = 'https://api.weather.gov/gridpoints/OKX/34,44/forecast/hourly?units=si';
const HOUR_MS = 60 * 60_000;
const WIND = /^(\d+)(?: to (\d+))? km\/h$/;

const timeWithOffset = z.iso.datetime({ offset: true });
const quantity = z.object({ unitCode: z.string(), value: z.number().nullable() });

const periodSchema = z.object({
  startTime: timeWithOffset,
  endTime: timeWithOffset,
  isDaytime: z.boolean(),
  temperature: z.number(),
  temperatureUnit: z.string(),
  probabilityOfPrecipitation: quantity,
  dewpoint: quantity,
  relativeHumidity: quantity,
  windSpeed: z.string(),
  windDirection: z.string(),
  shortForecast: z.string(),
});

const forecastSchema = z.object({
  properties: z.object({
    units: z.string(),
    /** When forecasters last changed the grid, which is the time of the data. */
    updateTime: timeWithOffset,
    periods: z.array(periodSchema).min(1),
  }),
});

type Period = z.infer<typeof periodSchema>;

const forecastHourSchema = z.object({
  startsAt: instantSchema,
  endsAt: instantSchema,
  isDaytime: z.boolean(),
  temperatureC: z.number(),
  dewpointC: z.number().nullable(),
  /** Chance of precipitation in percent. */
  precipitationChance: z.number().min(0).max(100).nullable(),
  relativeHumidity: z.number().min(0).max(100).nullable(),
  windKmh: z.object({ min: z.number().nonnegative(), max: z.number().nonnegative() }),
  windDirection: z.string().nullable(),
  summary: z.string(),
});

const hourlyForecastSchema = z.object({
  updatedAt: instantSchema,
  location: z.object({
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    gridpoint: z.string(),
  }),
  hours: z.array(forecastHourSchema),
});

type ForecastHour = z.infer<typeof forecastHourSchema>;
export type HourlyForecast = z.infer<typeof hourlyForecastSchema>;

/** The units asked for (`units=si`); any other answer would be read with the wrong scale. */
function unitProblem(units: string, period: Period): string | undefined {
  if (units !== 'si') return `units is "${units}"`;
  if (period.temperatureUnit !== 'C') return `temperatureUnit is "${period.temperatureUnit}"`;
  if (period.probabilityOfPrecipitation.unitCode !== 'wmoUnit:percent') {
    return `probabilityOfPrecipitation is in ${period.probabilityOfPrecipitation.unitCode}`;
  }
  if (period.dewpoint.unitCode !== 'wmoUnit:degC')
    return `dewpoint is in ${period.dewpoint.unitCode}`;
  if (!WIND.test(period.windSpeed)) return `windSpeed is "${period.windSpeed}"`;
  return undefined;
}

function toHour(period: Period): ForecastHour {
  const wind = WIND.exec(period.windSpeed);
  const low = Number(wind?.[1]);
  const high = wind?.[2] === undefined ? low : Number(wind[2]);
  return {
    startsAt: toInstant(new Date(period.startTime)),
    endsAt: toInstant(new Date(period.endTime)),
    isDaytime: period.isDaytime,
    temperatureC: period.temperature,
    dewpointC: period.dewpoint.value,
    precipitationChance: period.probabilityOfPrecipitation.value,
    relativeHumidity: period.relativeHumidity.value,
    windKmh: { min: low, max: high },
    windDirection: period.windDirection.trim() === '' ? null : period.windDirection.trim(),
    summary: period.shortForecast,
  };
}

/** Hours of one hour each, each starting where the previous one ends. */
function sequenceProblem(hours: readonly ForecastHour[]): string | undefined {
  for (const [index, hour] of hours.entries()) {
    if (Date.parse(hour.endsAt) - Date.parse(hour.startsAt) !== HOUR_MS) {
      return `hour ${String(index + 1)} runs from ${hour.startsAt} to ${hour.endsAt}`;
    }
    const before = hours[index - 1];
    if (before !== undefined && before.endsAt !== hour.startsAt) {
      return `hour ${String(index + 1)} starts at ${hour.startsAt}, after ${before.endsAt}`;
    }
  }
  return undefined;
}

function readHours(
  body: Uint8Array,
): { readonly ok: true; readonly updatedAt: Date; readonly hours: ForecastHour[] } | Refusal {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = forecastSchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  const { units, updateTime, periods } = parsed.data.properties;
  for (const period of periods) {
    const problem = unitProblem(units, period);
    if (problem !== undefined) return refuse('wrong-units', `${problem}; expected SI units.`);
  }
  return { ok: true, updatedAt: new Date(updateTime), hours: periods.map(toHour) };
}

function parseForecast(body: Uint8Array, receivedAt: Date): ParseResult<HourlyForecast> {
  const read = readHours(body);
  if (!read.ok) return read;
  const broken = sequenceProblem(read.hours);
  if (broken !== undefined)
    return refuse('broken-sequence', `The hours are not contiguous: ${broken}.`);
  const last = read.hours.at(-1);
  if (last === undefined || Date.parse(last.endsAt) <= receivedAt.getTime()) {
    return refuse(
      'no-future-hours',
      `Every hour ends before the download, the last at ${last?.endsAt ?? '-'}.`,
    );
  }
  return {
    ok: true,
    data: {
      updatedAt: toInstant(read.updatedAt),
      location: { ...FORECAST_POINT },
      hours: read.hours,
    },
    dataTime: read.updatedAt,
    coverage: `${String(read.hours.length)} hours, until ${last.endsAt}`,
  };
}

/**
 * Hourly forecast of the National Weather Service for a central point of Manhattan: temperature,
 * chance of precipitation, humidity and wind for about a week ahead.
 *
 * Rhythm and freshness: forecasters issue the grid at least twice a day and update it as the
 * weather changes (`updateTime` 23:08 UTC on 10/11/2026, read at 01:04); the service caches the
 * answer for up to an hour. Every 15 minutes sees a new issue soon enough. Older than 13 hours
 * (one routine issue missed) is degraded, older than 25 hours stale, older than 2 days unusable.
 *
 * Identity: answered the platform's generic browser `User-Agent`, without contact, on 11/11/2026.
 */
export const nwsHourlyForecastSource: SourceDefinition<HourlyForecast> = {
  id: 'nws-hourly-forecast-manhattan',
  title: 'Manhattan hourly forecast',
  provider: 'National Weather Service (api.weather.gov)',
  licence: NWS_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 15 * 60_000 },
  freshness: {
    degradedAfterMs: 13 * HOUR_MS,
    staleAfterMs: 25 * HOUR_MS,
    unavailableAfterMs: 48 * HOUR_MS,
  },
  limits: { timeoutMs: 20_000, maxBytes: 1024 * 1024 },
  keepVersions: 1,
  dataSchema: hourlyForecastSchema,
  request() {
    return { url: FORECAST_URL, headers: { accept: 'application/geo+json' } };
  },
  parse(body, { receivedAt }) {
    return parseForecast(body, receivedAt);
  },
  check(data, previous) {
    return olderThanServed(data.updatedAt, previous?.updatedAt);
  },
  consumers: ['weather', 'sara-briefing'],
  failures: [
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page.',
      state: 'degraded',
      remedy: 'Keep the last good forecast with its age; the next run tries again.',
    },
    {
      code: 'unexpected-shape',
      detection: 'No properties.periods, or an hour without its fields.',
      state: 'misconfigured',
      remedy: 'The API changed: compare with the capture and update the reader.',
    },
    {
      code: 'wrong-units',
      detection:
        'Not SI: units, temperatureUnit, a unit code or windSpeed differ from km/h and °C.',
      state: 'misconfigured',
      remedy: 'The units parameter was ignored or changed: fix the request before serving.',
    },
    {
      code: 'broken-sequence',
      detection: 'An hour does not last one hour or does not start where the previous ends.',
      state: 'degraded',
      remedy: 'Keep the last good forecast; a gap would place weather at the wrong time.',
    },
    {
      code: 'no-future-hours',
      detection: 'Every hour ends before the download: a cached forecast of another day.',
      state: 'degraded',
      remedy: 'Keep the last good forecast ageing; the next issue replaces it.',
    },
    {
      code: 'older-than-served',
      detection: '`updateTime` is earlier than the one served: a lagging cache.',
      state: 'degraded',
      remedy: 'Keep the newer forecast; the cache catches up within the hour.',
    },
  ],
};
