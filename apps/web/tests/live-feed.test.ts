import { journeySchema, type Journey } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  RETRY_DELAYS_MS,
  createLiveFeed,
  type FeedStatus,
  type StreamLike,
} from '../src/features/trip/live/feed';
import { journey } from './fixtures/journeys';

/** A stream the test opens, feeds and breaks by hand. */
class FakeStream implements StreamLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  open() {
    this.onopen?.(new Event('open'));
  }
  send(data: unknown, lastEventId = '') {
    this.onmessage?.(new MessageEvent('message', { data, lastEventId }));
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
  close() {
    this.closed = true;
  }
}

function harness() {
  let clock = 1_000_000;
  const streams: FakeStream[] = [];
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const statuses: FeedStatus[] = [];
  const data: Journey[] = [];
  let rejected = 0;
  const feed = createLiveFeed(
    '/api/journeys/trip-ok/events',
    journeySchema,
    {
      open: () => {
        const stream = new FakeStream();
        streams.push(stream);
        return stream;
      },
      now: () => clock,
      setTimer: (run, ms) => {
        const timer = { at: clock + ms, run, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    },
    {
      onData: (j) => data.push(j),
      onStatus: (s) => statuses.push(s),
      onRejected: () => (rejected += 1),
    },
  );
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.filter((t) => !t.cancelled && t.at <= clock)) {
      timer.cancelled = true;
      timer.run();
    }
  };
  const last = () => streams.at(-1) ?? new FakeStream();
  return { feed, streams, statuses, data, advance, last, rejected: () => rejected };
}

const snapshot = JSON.stringify(journey(Date.parse('2026-11-11T12:00:00.000Z'), 'en', false));

describe('the live feed of a journey', () => {
  it('says connecting, then live, and passes on every valid snapshot', () => {
    const h = harness();
    h.feed.start();
    expect(h.statuses.at(-1)).toEqual({ kind: 'connecting' });
    h.last().open();
    expect(h.statuses.at(-1)).toEqual({ kind: 'live', since: 1_000_000 });
    h.last().send(snapshot);
    expect(h.data[0]?.id).toBe('trip-ok');
  });

  it('takes the server events as they come: unnamed, with their version as the event id', () => {
    const h = harness();
    h.feed.start();
    h.last().open();
    h.last().send(snapshot, '7');
    h.last().send(snapshot, '8');
    expect(h.data.map((j) => j.id)).toEqual(['trip-ok', 'trip-ok']);
    expect(h.rejected()).toBe(0);
  });

  it('refuses an event outside the contract instead of showing it', () => {
    const h = harness();
    h.feed.start();
    h.last().open();
    h.last().send('{"id": 3}');
    h.last().send('not json');
    expect(h.data).toEqual([]);
    expect(h.rejected()).toBe(2);
  });

  it('says since when it is lost, retries with a growing wait and keeps the first instant', () => {
    const h = harness();
    h.feed.start();
    h.last().open();
    h.advance(5_000);
    h.last().fail();
    expect(h.streams[0]?.closed).toBe(true);
    expect(h.statuses.at(-1)).toEqual({
      kind: 'lost',
      since: 1_005_000,
      retryAt: 1_005_000 + RETRY_DELAYS_MS[0],
    });
    h.advance(RETRY_DELAYS_MS[0]);
    expect(h.streams).toHaveLength(2);
    h.last().fail();
    expect(h.statuses.at(-1)).toMatchObject({ kind: 'lost', since: 1_005_000 });
    const second = h.statuses.at(-1);
    expect(second?.kind === 'lost' && second.retryAt - (1_005_000 + RETRY_DELAYS_MS[0])).toBe(
      RETRY_DELAYS_MS[1],
    );
  });

  it('reconnects at once when asked, without waiting for the next attempt', () => {
    const h = harness();
    h.feed.start();
    h.last().fail();
    expect(h.streams).toHaveLength(1);
    h.feed.reconnect();
    expect(h.streams).toHaveLength(2);
    h.last().open();
    expect(h.statuses.at(-1)?.kind).toBe('live');
    h.advance(60_000);
    expect(h.streams).toHaveLength(2);
  });

  it('closes everything on stop and never opens again', () => {
    const h = harness();
    h.feed.start();
    h.last().fail();
    h.feed.stop();
    h.advance(60_000);
    expect(h.streams).toHaveLength(1);
    h.feed.reconnect();
    expect(h.streams).toHaveLength(1);
  });
});
