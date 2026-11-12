import type { CityItem } from '@moviq/contracts';

import { nwsAlertsSource } from '../../data-platform/sources/city/nws-alerts.js';
import { ny511WeatherWarnings } from '../../data-platform/sources/ny511/event-layers.js';
import { ny511RoadConditions } from '../../data-platform/sources/ny511/road-conditions.js';
import { NO_PLACE, placeOf } from '../geometry.js';
import { layerOf, part, type CityLayer } from '../layer.js';
import { roadEventPart } from './road-events.js';

/** The road surface as NYSDOT words it, segment by segment. */
const roadConditions = layerOf('road-conditions', 'weather', [
  part({
    source: ny511RoadConditions,
    items: (data): CityItem[] =>
      data.segments.map((segment) => ({
        id: `road-conditions:${segment.id}`,
        layer: 'road-conditions',
        sourceId: ny511RoadConditions.id,
        title: segment.road,
        ...placeOf(segment.geometry),
        detail: {
          kind: 'road-condition',
          road: segment.road,
          between: segment.between,
          condition: segment.condition,
          updatedAt: segment.updatedAt,
        },
      })),
  }),
]);

/**
 * The alerts of the National Weather Service for New York City still valid at `now`, listed by
 * zone, and 511NY's weather warnings over the roads.
 */
const weatherAlerts = layerOf('weather-alerts', 'weather', [
  part({
    source: nwsAlertsSource,
    timely: true,
    items: (data, now): CityItem[] =>
      data.alerts
        .filter((alert) => Date.parse(alert.expiresAt) > now.getTime())
        .map((alert) => ({
          id: `weather-alerts:${alert.id}`,
          layer: 'weather-alerts',
          sourceId: nwsAlertsSource.id,
          title: alert.event,
          ...NO_PLACE,
          detail: {
            kind: 'weather-alert',
            severity: alert.severity,
            headline: alert.headline,
            description: alert.description,
            instruction: alert.instruction,
            area: alert.area,
            sender: alert.sender,
            startsAt: alert.startsAt,
            endsAt: alert.endsAt,
            expiresAt: alert.expiresAt,
          },
        })),
  }),
  roadEventPart('weather-alerts', ny511WeatherWarnings),
]);

export const weatherLayers: readonly CityLayer[] = [roadConditions, weatherAlerts];
