import type { MovIqEvent } from '@moviq/contracts';

import { travellerHref } from '../../../../shared/routing/hrefs';

/**
 * Planning with Sara towards the event: the venue as destination and its start as the time to be
 * there by. The planning screen reads these parameters after `#/plan?`.
 */
export function planHref(event: MovIqEvent): string {
  const query = new URLSearchParams({
    to: event.venue.name,
    lat: String(event.venue.lat),
    lon: String(event.venue.lon),
    arriveBy: event.startsAt,
    event: event.id,
  });
  return `${travellerHref.plan}?${query.toString()}`;
}
