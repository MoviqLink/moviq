import { toInstant } from '@moviq/contracts';

import type { Licence, ParseContext, ParseResult, SourceDefinition } from '../../definition.js';
import type { GtfsRealtimeFeed } from '../../formats/gtfs-realtime.js';
import { alertsFeedSchema, type AlertsFeed } from '../mta/alerts.js';
import { MINUTE, count } from '../mta/provider.js';
import { instantOf, readRealtimeFeed } from '../mta/realtime-feed.js';
import { GTFS_REALTIME_FAILURES } from '../regional/provider-failures.js';
import {
  NY_WATERWAY_HTTP_FAILURES,
  NY_WATERWAY_LICENCE,
  NY_WATERWAY_PROVIDER,
} from './ny-waterway.js';
import {
  NYC_FERRY_HTTP_FAILURES,
  NYC_FERRY_LICENCE,
  NYC_FERRY_PROVIDER,
} from './nyc-ferry-realtime.js';

type Alert = NonNullable<GtfsRealtimeFeed['entity'][number]['alert']>;
type ServiceAlert = AlertsFeed['alerts'][number];

/** The plain text in English, or in no stated language, as the MTA alerts read it. */
function plainText(text: Alert['header_text']): string | null {
  const plain = (text?.translation ?? []).filter((item) => !(item.language ?? '').includes('html'));
  const chosen =
    plain.find((item) => item.language === 'en') ??
    plain.find((item) => item.language === undefined || item.language === '');
  const value = chosen?.text.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * One alert in the shape of the MTA alerts (`mta-alerts`), so the map, the route sheet and the
 * trip watch read both alike. Routes, stops and trips keep the ids of the operator's own GTFS.
 */
function alertOf(id: string, alert: Alert): ServiceAlert | undefined {
  const header = plainText(alert.header_text);
  const affected = alert.informed_entity.map((entity) => ({
    agencyId: entity.agency_id ?? null,
    routeId: entity.route_id ?? entity.trip?.route_id ?? null,
    stopId: entity.stop_id ?? null,
    tripId: entity.trip?.trip_id ?? null,
  }));
  if (header === null || affected.length === 0) return undefined;
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
    description: plainText(alert.description_text),
  };
}

/** An empty feed with a valid header is a quiet day, not a failure: it is served as 0 alerts. */
function parseFerryAlerts(
  body: Uint8Array,
  context: ParseContext<AlertsFeed>,
): ParseResult<AlertsFeed> {
  const read = readRealtimeFeed(body, context.receivedAt, context.previous?.feedTime);
  if (!read.ok) return read;
  const alerts = read.feed.entity.flatMap((entity) =>
    entity.alert ? (alertOf(entity.id, entity.alert) ?? []) : [],
  );
  const leftOut = read.feed.entity.length - alerts.length;
  return {
    ok: true,
    data: { feedTime: toInstant(read.feedTime), alerts, leftOut },
    dataTime: read.feedTime,
    coverage: `${count(alerts.length, 'alerts')}, ${String(leftOut)} left out`,
  };
}

interface FerryAlertsHost {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly licence: Licence;
  readonly host: string;
  readonly failures: SourceDefinition['failures'];
}

/**
 * Both Connexionz hosts rebuild the feed every 2 minutes: on 11/11/2026 the header, at 03:58:00
 * UTC, matched `Last-Modified`, and `Expires` was 04:00:00. Reading it more often brings nothing
 * new; three missed rebuilds degrade it.
 */
function ferryAlerts(host: FerryAlertsHost): SourceDefinition<AlertsFeed> {
  return {
    id: host.id,
    title: host.title,
    provider: host.provider,
    licence: host.licence,
    kind: 'realtime',
    rhythm: { class: 'warm', baseIntervalMs: 2 * MINUTE },
    freshness: {
      degradedAfterMs: 6 * MINUTE,
      staleAfterMs: 15 * MINUTE,
      unavailableAfterMs: 60 * MINUTE,
    },
    limits: { timeoutMs: 15_000, maxBytes: 512 * 1024 },
    keepVersions: 1,
    dataSchema: alertsFeedSchema,
    request() {
      return { url: `https://${host.host}/rtt/public/utility/gtfsrealtime.aspx/alert` };
    },
    parse(body, context) {
      return parseFerryAlerts(body, context);
    },
    consumers: ['live-map', 'service-alerts', 'trip-watch'],
    failures: [...host.failures, ...GTFS_REALTIME_FAILURES],
  };
}

/**
 * NYC Ferry service alerts, listed on https://www.ferry.nyc/developer-tools/ under the developer
 * terms of the other NYC Ferry feeds. Routes and stops join `nyc-ferry-gtfs`.
 */
const nycFerryAlerts = ferryAlerts({
  id: 'nyc-ferry-alerts',
  title: 'NYC Ferry service alerts',
  provider: NYC_FERRY_PROVIDER,
  licence: NYC_FERRY_LICENCE,
  host: 'nycferry.connexionz.net',
  failures: NYC_FERRY_HTTP_FAILURES,
});

/**
 * NY Waterway service alerts, on the same Connexionz system. Routes and stops join
 * `ny-waterway-gtfs`.
 */
const nyWaterwayAlerts = ferryAlerts({
  id: 'ny-waterway-alerts',
  title: 'NY Waterway service alerts',
  provider: NY_WATERWAY_PROVIDER,
  licence: NY_WATERWAY_LICENCE,
  host: 'nywaterway.connexionz.net',
  failures: NY_WATERWAY_HTTP_FAILURES,
});

export const ferryAlertSources = [nycFerryAlerts, nyWaterwayAlerts] as const;
