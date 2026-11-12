import { instantSchema, toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { MINUTE, MTA_FEEDS_URL, MTA_LICENCE, MTA_PROVIDER, count } from './provider.js';
import { REALTIME_FAILURES, instantOf, readRealtimeFeed } from './realtime-feed.js';

const periodSchema = z.object({
  /** Null start: active since before the feed says; null end: until further notice. */
  start: instantSchema.nullable(),
  end: instantSchema.nullable(),
});

const affectedSchema = z.object({
  /** `MTASBWY` subway, `MTA NYCT` and `MTABC` buses, `LI` Long Island Rail Road, `MNR` Metro-North. */
  agencyId: z.string().nullable(),
  routeId: z.string().nullable(),
  stopId: z.string().nullable(),
  tripId: z.string().nullable(),
});

const alertSchema = z.object({
  id: z.string().min(1),
  /** An empty list means active for as long as the alert is in the feed. */
  activePeriods: z.array(periodSchema),
  affected: z.array(affectedSchema).min(1),
  /** GTFS Realtime cause and effect names; the MTA leaves both out today. */
  cause: z.string().nullable(),
  effect: z.string().nullable(),
  /** Plain English text as published; the HTML variants are not kept. */
  header: z.string().min(1),
  description: z.string().nullable(),
});

export const alertsFeedSchema = z.object({
  feedTime: instantSchema,
  alerts: z.array(alertSchema),
  /** Alerts without English text or without anything they affect. */
  leftOut: z.number().int().nonnegative(),
});

export type AlertsFeed = z.infer<typeof alertsFeedSchema>;
type ServiceAlert = z.infer<typeof alertSchema>;

type Alert = NonNullable<GtfsRealtimeFeed['entity'][number]['alert']>;

function englishText(text: Alert['header_text']): string | null {
  const translations = text?.translation ?? [];
  const plain = translations.filter((item) => !(item.language ?? '').includes('html'));
  const chosen =
    plain.find((item) => item.language === 'en') ??
    plain.find((item) => item.language === undefined || item.language === '');
  const value = chosen?.text.trim() ?? '';
  return value === '' ? null : value;
}

function alertOf(id: string, alert: Alert): ServiceAlert | undefined {
  const header = englishText(alert.header_text);
  const affected = alert.informed_entity.map((entity) => ({
    agencyId: entity.agency_id ?? null,
    routeId: entity.route_id ?? entity.trip?.route_id ?? null,
    stopId: entity.stop_id ?? null,
    tripId: entity.trip?.trip_id ?? null,
  }));
  if (header === null || affected.length === 0) return;
  return {
    id,
    activePeriods: alert.active_period.map((period) => ({
      start: instantOf(period.start),
      end: instantOf(period.end),
    })),
    affected,
    cause: alert.cause ?? null,
    effect: alert.effect ?? null,
    header,
    description: englishText(alert.description_text),
  };
}

export const mtaAlerts: SourceDefinition<AlertsFeed> = {
  id: 'mta-alerts',
  title: 'MTA service alerts (subway, buses, LIRR, Metro-North)',
  provider: MTA_PROVIDER,
  licence: MTA_LICENCE,
  kind: 'realtime',
  // The header of the 11/11/2026 capture was under 3 minutes old: the MTA rebuilds this feed every
  // few minutes, so a read every 2 minutes, or every minute while a trip is watched, is enough.
  rhythm: { class: 'warm', baseIntervalMs: 2 * MINUTE, interestIntervalMs: MINUTE },
  freshness: {
    degradedAfterMs: 10 * MINUTE,
    staleAfterMs: 20 * MINUTE,
    unavailableAfterMs: 60 * MINUTE,
  },
  limits: { timeoutMs: 20_000, maxBytes: 8 * 1024 * 1024 },
  keepVersions: 1,
  dataSchema: alertsFeedSchema,
  request() {
    return { url: `${MTA_FEEDS_URL}camsys%2Fall-alerts` };
  },
  parse(body, context) {
    const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
    if (!read.ok) return read;
    const alerts = read.feed.entity.flatMap((entity) =>
      entity.alert ? (alertOf(entity.id, entity.alert) ?? []) : [],
    );
    const leftOut = read.feed.entity.length - alerts.length;
    // Planned work is always announced somewhere in the network, so no alert at all means a failure.
    if (alerts.length === 0) {
      return { ok: false, code: 'empty-feed', detail: `${String(leftOut)} entities, none usable` };
    }
    return {
      ok: true,
      data: { feedTime: toInstant(read.feedTime), alerts, leftOut },
      dataTime: read.feedTime,
      coverage: `${count(alerts.length, 'alerts')}, ${String(leftOut)} left out`,
    };
  },
  consumers: ['service-alerts', 'trip-watch', 'sara-briefing'],
  failures: [
    ...REALTIME_FAILURES,
    {
      code: 'empty-feed',
      detection: 'No alert with English text, while planned work is always announced',
      state: 'degraded',
      remedy: 'Refused, so a broken feed never reads as "no incidents"; the last list ages',
    },
  ],
};
