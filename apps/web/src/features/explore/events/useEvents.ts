import type { EventCategory, EventsResponse, MovIqEvent } from '@moviq/contracts';
import { useEffect, useMemo, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { startPolling } from '../live/poll';
import { fetchEvents } from './api';
import { ofCategory } from './model/layer';
import { rangeWindow, type EventRange } from './model/range';

/** Listings change a few times a day; their sources are read every 30 minutes at most. */
const POLL_MS = 5 * 60_000;

export interface EventLayer {
  readonly on: boolean;
  readonly range: EventRange;
  readonly category: EventCategory | null;
  readonly data: EventsResponse | null;
  /** True while the last request failed; the last good answer stays. */
  readonly failing: boolean;
  readonly toggle: () => void;
  readonly setRange: (range: EventRange) => void;
  readonly setCategory: (category: EventCategory | null) => void;
}

/**
 * The events layer: off by default, the rest of today first. The window is worked out again on
 * each read, so "tonight" never keeps an hour already gone; leaving the screen stops it all.
 */
function useEvents(): EventLayer {
  const [on, setOn] = useState(false);
  const [range, setRange] = useState<EventRange>('today');
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [failing, setFailing] = useState(false);

  useEffect(() => {
    if (!on) return;
    return startPolling(async (signal) => {
      try {
        const answer = await fetchEvents(rangeWindow(range, new Date()), signal);
        if (!signal.aborted) {
          setData(answer);
          setFailing(false);
        }
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof ApiRequestError && error.failure.kind === 'aborted')
        )
          return;
        setFailing(true);
      }
    }, POLL_MS);
  }, [range, on]);

  return useMemo(
    () => ({
      on,
      range,
      category,
      data,
      failing,
      toggle: () => {
        setOn((value) => !value);
      },
      setRange: (next: EventRange) => {
        setCategory(null);
        setRange(next);
      },
      setCategory,
    }),
    [on, range, category, data, failing],
  );
}

/** The layer, the events it draws (none while off) and the one selected, if it is an event. */
export function useEventsOnMap(selectedId: string | null): {
  readonly layer: EventLayer;
  readonly events: readonly MovIqEvent[];
  readonly selected: MovIqEvent | undefined;
} {
  const layer = useEvents();
  const events = useMemo(
    () => (layer.on ? ofCategory(layer.data?.events ?? [], layer.category) : []),
    [layer],
  );
  return { layer, events, selected: events.find((event) => event.id === selectedId) };
}
