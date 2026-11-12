import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { ParseResult, SourceDefinition } from '../../definition.js';
import { NWS_LICENCE } from './nws-licence.js';
import { decodeJson, describeIssue, olderThanServed, refuse } from './parsing.js';

/** Public forecast zones of the five boroughs, as listed by `/zones?type=forecast&area=NY`. */
const NEW_YORK_ZONES = ['NYZ072', 'NYZ073', 'NYZ074', 'NYZ075', 'NYZ176', 'NYZ178'] as const;

const newYorkZones: ReadonlySet<string> = new Set(NEW_YORK_ZONES);

const ZONE_URL = /^https:\/\/api\.weather\.gov\/zones\/[a-z]+\/([A-Z]{2}[CZ]\d{3})$/;

const timeWithOffset = z.iso.datetime({ offset: true });

const alertFeatureSchema = z.object({
  properties: z.object({
    id: z.string().min(1),
    areaDesc: z.string(),
    affectedZones: z.array(z.string().regex(ZONE_URL)),
    sent: timeWithOffset,
    effective: timeWithOffset,
    onset: timeWithOffset.nullish(),
    expires: timeWithOffset,
    ends: timeWithOffset.nullish(),
    status: z.string(),
    messageType: z.string(),
    severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
    certainty: z.string(),
    urgency: z.string(),
    event: z.string().min(1),
    senderName: z.string(),
    headline: z.string().nullish(),
    description: z.string().nullish(),
    instruction: z.string().nullish(),
  }),
});

const collectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  /** When the alert service last changed, which is the time of the data. */
  updated: timeWithOffset,
  features: z.array(alertFeatureSchema),
});

type AlertProperties = z.infer<typeof alertFeatureSchema>['properties'];

const weatherAlertSchema = z.object({
  id: z.string(),
  event: z.string(),
  severity: z.enum(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']),
  certainty: z.string(),
  urgency: z.string(),
  messageType: z.string(),
  headline: z.string().nullable(),
  description: z.string().nullable(),
  instruction: z.string().nullable(),
  sender: z.string(),
  area: z.string(),
  /** Zone codes the alert covers, such as `NYZ072`. */
  zones: z.array(z.string()),
  sentAt: instantSchema,
  /** When the hazard begins: the onset, or the effective time when no onset is given. */
  startsAt: instantSchema,
  /** When the hazard ends, when the alert says so. */
  endsAt: instantSchema.nullable(),
  /** When this message stops being valid; a newer message may follow. */
  expiresAt: instantSchema,
});

const newYorkWeatherAlertsSchema = z.object({
  updatedAt: instantSchema,
  /** Empty when no alert is active, which is valid data. */
  alerts: z.array(weatherAlertSchema),
});

type WeatherAlert = z.infer<typeof weatherAlertSchema>;
export type NewYorkWeatherAlerts = z.infer<typeof newYorkWeatherAlertsSchema>;

function instant(value: string): string {
  return toInstant(new Date(value));
}

function zoneOf(url: string): string {
  return ZONE_URL.exec(url)?.[1] ?? url;
}

function toAlert(properties: AlertProperties): WeatherAlert {
  const ends = properties.ends ?? null;
  return {
    id: properties.id,
    event: properties.event,
    severity: properties.severity,
    certainty: properties.certainty,
    urgency: properties.urgency,
    messageType: properties.messageType,
    headline: properties.headline ?? null,
    description: properties.description ?? null,
    instruction: properties.instruction ?? null,
    sender: properties.senderName,
    area: properties.areaDesc,
    zones: properties.affectedZones.map(zoneOf),
    sentAt: instant(properties.sent),
    startsAt: instant(properties.onset ?? properties.effective),
    endsAt: ends === null ? null : instant(ends),
    expiresAt: instant(properties.expires),
  };
}

function parseAlerts(body: Uint8Array): ParseResult<NewYorkWeatherAlerts> {
  const decoded = decodeJson(body);
  if (!decoded.ok) return decoded;
  const parsed = collectionSchema.safeParse(decoded.value);
  if (!parsed.success) return refuse('unexpected-shape', describeIssue(parsed.error));
  // Test, exercise and system messages are not weather: they never reach a traveller.
  const alerts = parsed.data.features
    .map((feature) => feature.properties)
    .filter((properties) => properties.status === 'Actual')
    .map(toAlert);
  const updatedAt = new Date(parsed.data.updated);
  return {
    ok: true,
    data: { updatedAt: toInstant(updatedAt), alerts },
    dataTime: updatedAt,
    coverage: `${String(NEW_YORK_ZONES.length)} zones, ${String(alerts.length)} active alerts`,
  };
}

function outsideNewYork(data: NewYorkWeatherAlerts): string[] {
  return data.alerts
    .filter((alert) => !alert.zones.some((zone) => newYorkZones.has(zone)))
    .map((alert) => `outside-zones: ${alert.id} (${alert.event}) covers ${alert.zones.join(', ')}`);
}

/**
 * Active watches, warnings and advisories of the National Weather Service for the five
 * boroughs. No active alert is valid data; a failed answer is not, and says "alerts not
 * available" through the age of the last good one.
 *
 * Rhythm and freshness: alerts are issued at any time and the service caches its answer for 5
 * seconds; `updated` moved from 01:00:00 to 01:10:50 UTC between two reads on 11/11/2026. Every
 * 5 minutes at rest and every 2 while a trip is watched; 15 minutes without a new `updated` is
 * degraded, an hour stale.
 *
 * Identity: the service asks for a `User-Agent`; it answered the generic browser identity the
 * platform sends, without any contact, on 11/11/2026.
 */
export const nwsAlertsSource: SourceDefinition<NewYorkWeatherAlerts> = {
  id: 'nws-alerts-new-york',
  title: 'New York weather alerts',
  provider: 'National Weather Service (api.weather.gov)',
  licence: NWS_LICENCE,
  kind: 'realtime',
  rhythm: { class: 'warm', baseIntervalMs: 5 * 60_000, interestIntervalMs: 2 * 60_000 },
  freshness: {
    degradedAfterMs: 15 * 60_000,
    staleAfterMs: 60 * 60_000,
    unavailableAfterMs: 3 * 60 * 60_000,
  },
  limits: { timeoutMs: 15_000, maxBytes: 2 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: newYorkWeatherAlertsSchema,
  request() {
    return {
      url: `https://api.weather.gov/alerts/active?zone=${NEW_YORK_ZONES.join(',')}`,
      headers: { accept: 'application/geo+json' },
    };
  },
  parse(body) {
    return parseAlerts(body);
  },
  check(data, previous) {
    return [...olderThanServed(data.updatedAt, previous?.updatedAt), ...outsideNewYork(data)];
  },
  consumers: ['weather', 'trip-watch', 'sara-briefing'],
  failures: [
    {
      code: 'not-json',
      detection: 'The body is not JSON, such as an HTML error page.',
      state: 'degraded',
      remedy: 'Say "alerts not available" with the age of the last good answer; retry next run.',
    },
    {
      code: 'unexpected-shape',
      detection: 'Not a FeatureCollection with `updated`, or an alert without its fields.',
      state: 'misconfigured',
      remedy: 'The API changed: compare with the capture and update the reader.',
    },
    {
      code: 'older-than-served',
      detection: '`updated` is earlier than the one served: a lagging cache.',
      state: 'degraded',
      remedy: 'Keep the newer alerts; the next run normally brings current ones.',
    },
    {
      code: 'outside-zones',
      detection: 'An alert covers none of the five boroughs: the zone filter was not applied.',
      state: 'misconfigured',
      remedy: 'Check the request URL and the zone codes before serving alerts again.',
    },
  ],
};
