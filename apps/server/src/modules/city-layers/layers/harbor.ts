import type { CityItem } from '@moviq/contracts';

import { newYorkGtfsDate } from '../../../infrastructure/clock/new-york.js';
import { coastGuardNotices } from '../../data-platform/sources/harbor/coast-guard-notices.js';
import type { PortsReading } from '../../data-platform/sources/harbor/noaa-ports-reading.js';
import { portsSources } from '../../data-platform/sources/harbor/noaa-ports.js';
import { pnctVesselSchedule } from '../../data-platform/sources/harbor/pnct-vessel-schedule.js';
import { NO_PLACE } from '../geometry.js';
import { layerOf, part, type CityLayer } from '../layer.js';

/**
 * Ship calls at Port Newark Container Terminal, as its page lists them: listed, not drawn. A call
 * whose ship left before today is history, not the port now, and is left out.
 */
const vesselCalls = layerOf('vessel-calls', 'harbor', [
  part({
    source: pnctVesselSchedule,
    timely: true,
    items: (data, now): CityItem[] =>
      data.calls
        .filter(
          (call) =>
            call.departed === null ||
            newYorkGtfsDate(new Date(call.departed)) === newYorkGtfsDate(now),
        )
        .map((call) => ({
          id: `vessel-calls:${call.visit}`,
          layer: 'vessel-calls',
          sourceId: pnctVesselSchedule.id,
          title: call.vessel,
          ...NO_PLACE,
          detail: {
            kind: 'vessel-call',
            line: call.line,
            expectedArrival: call.expectedArrival,
            arrived: call.arrived,
            expectedDeparture: call.expectedDeparture,
            departed: call.departed,
            stage: call.stage,
          },
        })),
  }),
]);

/** One NOAA station's latest measurement, at the place NOAA gives for the station. */
function readingItem(sourceId: string, data: PortsReading): CityItem {
  const { station, observation } = data;
  const { observedAt, ...reading } = observation;
  return {
    id: `harbor-conditions:${station.id}:${observation.measure}`,
    layer: 'harbor-conditions',
    sourceId,
    title: station.name,
    point: [station.longitude, station.latitude],
    lines: [],
    detail: { kind: 'harbor-reading', observedAt, reading },
  };
}

/** Water level, air gap under the Verrazzano, current and wind of NOAA PORTS. */
const harborConditions = layerOf(
  'harbor-conditions',
  'harbor',
  portsSources.map((source) =>
    part({ source, items: (data: PortsReading) => [readingItem(source.id, data)] }),
  ),
);

/**
 * Coast Guard notices still in force at `now`: not cancelled by a later notice and not past the
 * end they give themselves. A notice with no end stays while the feed lists it.
 */
const coastGuard = layerOf('coast-guard', 'harbor', [
  part({
    source: coastGuardNotices,
    timely: true,
    items: (data, now): CityItem[] =>
      data.notices
        .filter(
          (notice) =>
            notice.category !== 'CANCELLATION' &&
            notice.cancelledAt === null &&
            (notice.endsAt === null || Date.parse(notice.endsAt) > now.getTime()),
        )
        .map((notice) => ({
          id: `coast-guard:${notice.id}`,
          layer: 'coast-guard',
          sourceId: coastGuardNotices.id,
          title: notice.area ?? notice.subject ?? notice.category,
          ...NO_PLACE,
          detail: {
            kind: 'notice',
            category: notice.category,
            area: notice.area,
            subject: notice.subject,
            reference: notice.reference,
            publishedAt: notice.publishedAt,
            endsAt: notice.endsAt,
            text: notice.text,
            link: notice.link,
          },
        })),
  }),
]);

export const harborLayers: readonly CityLayer[] = [vesselCalls, harborConditions, coastGuard];
