import { eventsResponseSchema, type EventsResponse } from '@moviq/contracts';

import { api } from '../../../shared/api/client';
import type { TimeWindow } from './model/range';

/** Every event of the city in the window, with the state of each provider. */
export function fetchEvents(window: TimeWindow, signal: AbortSignal): Promise<EventsResponse> {
  const query = new URLSearchParams({
    from: window.from.toISOString(),
    to: window.to.toISOString(),
  });
  return api.json(`/api/events?${query.toString()}`, eventsResponseSchema, { signal });
}
