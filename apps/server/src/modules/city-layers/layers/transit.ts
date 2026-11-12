import type { CityItem } from '@moviq/contracts';

import { newYorkGtfsDate } from '../../../infrastructure/clock/new-york.js';
import type { SourceDefinition } from '../../data-platform/definition.js';
import { ferryAlertSources } from '../../data-platform/sources/ferries/ferry-alerts.js';
import type { AlertsFeed } from '../../data-platform/sources/mta/alerts.js';
import { ny511TransitEvents } from '../../data-platform/sources/ny511/event-layers.js';
import { pathAlertsSource } from '../../data-platform/sources/regional/path-alerts.js';
import { NO_PLACE } from '../geometry.js';
import { layerOf, part, type CityLayer, type LayerPart } from '../layer.js';
import { roadEventPart } from './road-events.js';

const dayOf = (instant: Date) => newYorkGtfsDate(instant);

/**
 * PATH's alerts open now, and those it closed today: PATH closes a one-off notice as it sends
 * it, so a notice of the morning is still listed, marked closed by PATH.
 */
const pathPart = part({
  source: pathAlertsSource,
  timely: true,
  items: (data, now): CityItem[] =>
    data.alerts
      .filter((alert) => alert.state === 'open' || dayOf(new Date(alert.sentAt)) === dayOf(now))
      .map((alert) => ({
        id: `transit-alerts:path:${alert.id}`,
        layer: 'transit-alerts',
        sourceId: pathAlertsSource.id,
        title: alert.subject,
        ...NO_PLACE,
        detail: {
          kind: 'transit-alert',
          network: 'PATH',
          text: alert.text,
          sentAt: alert.sentAt,
          periods: [],
          names: [...alert.linesNamed],
          closed: alert.state === 'closed',
        },
      })),
});

/** An alert applies at `now` when one of its periods holds it, or when it gives no period. */
function appliesAt(alert: AlertsFeed['alerts'][number], now: Date): boolean {
  if (alert.activePeriods.length === 0) return true;
  const at = now.getTime();
  return alert.activePeriods.some(
    (period) =>
      (period.start === null || Date.parse(period.start) <= at) &&
      (period.end === null || Date.parse(period.end) > at),
  );
}

/** The routes and stops a ferry alert names, by the operator's own ids. */
function namesOf(alert: AlertsFeed['alerts'][number]): string[] {
  const names = alert.affected.flatMap((entity) =>
    [entity.routeId, entity.stopId].filter((name): name is string => name !== null && name !== ''),
  );
  return [...new Set(names)];
}

function ferryPart(network: string, source: SourceDefinition<AlertsFeed>): LayerPart {
  return part({
    source,
    timely: true,
    items: (data, now): CityItem[] =>
      data.alerts
        .filter((alert) => appliesAt(alert, now))
        .map((alert) => ({
          id: `transit-alerts:${source.id}:${alert.id}`,
          layer: 'transit-alerts',
          sourceId: source.id,
          title: alert.header,
          ...NO_PLACE,
          detail: {
            kind: 'transit-alert',
            network,
            text: alert.description ?? '',
            sentAt: null,
            periods: alert.activePeriods.map((period) => ({ from: period.start, to: period.end })),
            names: namesOf(alert),
            closed: false,
          },
        })),
  });
}

const [nycFerryAlerts, nyWaterwayAlerts] = ferryAlertSources;

/** 511NY's transit events, PATH's alerts and the alerts of NYC Ferry and NY Waterway. */
const transitAlerts = layerOf('transit-alerts', 'transport', [
  roadEventPart('transit-alerts', ny511TransitEvents),
  pathPart,
  ferryPart('NYC Ferry', nycFerryAlerts),
  ferryPart('NY Waterway', nyWaterwayAlerts),
]);

export const transitLayers: readonly CityLayer[] = [transitAlerts];
