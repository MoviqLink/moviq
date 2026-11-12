import type { CitySource } from '@moviq/contracts';

import type { SourceDefinition } from '../../data-platform/definition.js';
import type { SourceReader } from '../../data-platform/reader.js';
import { ferryAlertSources } from '../../data-platform/sources/ferries/ferry-alerts.js';
import { mtaAlerts, type AlertsFeed } from '../../data-platform/sources/mta/alerts.js';
import { pathAlertsSource } from '../../data-platform/sources/regional/path-alerts.js';
import type { AlertFact, AlertList } from './findings.js';
import { plainAlertText, type CityMode } from './lines.js';
import { current, sourceOf } from './ports.js';

type Affected = AlertsFeed['alerts'][number]['affected'][number];

/** What an alert must affect to count: a route, a stop or an agency of the feed. */
type AlertMatch = (affected: Affected) => boolean;

export interface AlertsRead {
  readonly list: AlertList;
  readonly sources: readonly CitySource[];
}

/** At most this many alerts are told; the count says how many there are. */
export const MAX_ALERTS = 5;

/** Agencies of `mta-alerts` by mode: subway, buses (NYCT and MTA Bus), LIRR and Metro-North. */
const AGENCIES: Readonly<Partial<Record<CityMode, readonly string[]>>> = {
  subway: ['MTASBWY'],
  bus: ['MTA NYCT', 'MTABC'],
  rail: ['LI', 'MNR'],
};

export const byAgency =
  (mode: CityMode): AlertMatch =>
  (affected) =>
    affected.agencyId !== null && (AGENCIES[mode] ?? []).includes(affected.agencyId);

export const byRoute =
  (mode: 'subway' | 'bus', ids: readonly string[]): AlertMatch =>
  (affected) =>
    affected.routeId !== null && ids.includes(affected.routeId) && byAgency(mode)(affected);

/** A subway stop names its platforms with `N` and `S`: `A24N` belongs to station `A24`. */
export const byStation =
  (stationIds: readonly string[]): AlertMatch =>
  (affected) =>
    affected.stopId !== null && stationIds.includes(affected.stopId.replace(/[NS]$/, ''));

/** Alerts in force now: an empty list of periods means for as long as the alert is published. */
function inForce(feed: AlertsFeed, now: Date, match: AlertMatch): AlertFact[] {
  const at = now.getTime();
  return feed.alerts.flatMap((alert) => {
    if (!alert.affected.some(match)) return [];
    const period =
      alert.activePeriods.length === 0
        ? { start: null, end: null }
        : alert.activePeriods.find(
            ({ start, end }) =>
              (start === null || Date.parse(start) <= at) && (end === null || Date.parse(end) > at),
          );
    if (period === undefined) return [];
    return [{ text: plainAlertText(alert.header), since: period.start, until: period.end }];
  });
}

/** Reads GTFS Realtime alert feeds and keeps those in force that match. */
async function readAlerts(
  reader: SourceReader,
  definitions: readonly SourceDefinition<AlertsFeed>[],
  now: Date,
  match: AlertMatch,
): Promise<AlertsRead> {
  const read = await Promise.all(
    definitions.map(async (definition) => ({ definition, reading: await reader.read(definition) })),
  );
  const feeds = read.flatMap(({ reading }) => (reading.data === undefined ? [] : [reading.data]));
  const alerts = feeds.length === 0 ? null : feeds.flatMap((feed) => inForce(feed, now, match));
  return {
    list: { alerts, aged: !read.every(({ reading }) => current(reading)) },
    sources: read.map(({ definition, reading }) => sourceOf(definition, reading)),
  };
}

export const mtaAlertsIn = (reader: SourceReader, now: Date, match: AlertMatch) =>
  readAlerts(reader, [mtaAlerts], now, match);

export const ferryAlertsIn = (reader: SourceReader, now: Date) =>
  readAlerts(reader, ferryAlertSources, now, () => true);

/** PATH incidents still open, newest first; with `lines`, those naming one of them or none. */
export async function pathAlertsIn(
  reader: SourceReader,
  lines: readonly string[] | undefined,
): Promise<AlertsRead> {
  const reading = await reader.read(pathAlertsSource);
  const source = sourceOf(pathAlertsSource, reading);
  if (reading.data === undefined) return { list: { alerts: null, aged: true }, sources: [source] };
  const latest = new Map<string, AlertFact>();
  for (const alert of reading.data.alerts) {
    if (alert.state !== 'open' || latest.has(alert.incidentId)) continue;
    if (!concerns(alert.linesNamed, lines)) continue;
    latest.set(alert.incidentId, {
      text: plainAlertText(`${alert.subject}. ${alert.text}`),
      since: alert.sentAt,
      until: null,
    });
  }
  return { list: { alerts: [...latest.values()], aged: !current(reading) }, sources: [source] };
}

/** An alert naming no line concerns the whole system; one naming lines, only those. */
function concerns(named: readonly string[], asked: readonly string[] | undefined): boolean {
  if (asked === undefined || named.length === 0) return true;
  return named.some((line) => asked.includes(line));
}
