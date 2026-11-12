import { describe, expect, it } from 'vitest';

import { createApiClient } from '../src/shared/api/client';
import { answerOfError, loadTrip, type TripView } from '../src/features/home/trips/load';
import { settle, toneOf } from '../src/features/home/trips/model';
import { MAX_SAVED_TRIPS, createSavedTrips } from '../src/features/home/trips/saved';
import { ApiRequestError } from '../src/shared/api/errors';
import { journey as journeyAt } from './fixtures/journeys';

const journeyFixture = () => journeyAt(Date.parse('2026-11-11T12:00:00Z'), 'en', false);

function memory(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { raw: () => string } {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    raw: () => value ?? '',
  };
}

const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('the trips kept in this browser', () => {
  it('keeps ids only, newest first, each once', () => {
    const storage = memory();
    const trips = createSavedTrips(storage);
    trips.remember('a');
    trips.remember('b');
    trips.remember('a');
    expect(trips.list()).toEqual(['a', 'b']);
    expect(JSON.parse(storage.raw())).toEqual(['a', 'b']);
  });

  it(`keeps at most ${String(MAX_SAVED_TRIPS)}, forgetting the oldest`, () => {
    const trips = createSavedTrips(memory());
    for (let n = 0; n < MAX_SAVED_TRIPS + 3; n += 1) trips.remember(`trip-${String(n)}`);
    expect(trips.list()).toHaveLength(MAX_SAVED_TRIPS);
    expect(trips.list()[0]).toBe(`trip-${String(MAX_SAVED_TRIPS + 2)}`);
    expect(trips.list()).not.toContain('trip-0');
  });

  it('forgets one trip and reads anything broken as nothing kept', () => {
    const trips = createSavedTrips(memory('["a","b"]'));
    trips.forget('a');
    expect(trips.list()).toEqual(['b']);
    expect(createSavedTrips(memory('not json')).list()).toEqual([]);
    expect(createSavedTrips(memory('{"a":1}')).list()).toEqual([]);
    expect(createSavedTrips(memory('["a", 3, "", null, "a"]')).list()).toEqual(['a']);
    expect(createSavedTrips(null).list()).toEqual([]);
  });
});

describe('each saved trip asked for to the server', () => {
  it('reads the journey of the contract', async () => {
    const journey = journeyFixture();
    const client = createApiClient(json(200, journey));
    const answer = await loadTrip(journey.id, new AbortController().signal, client);
    expect(answer).toEqual({ kind: 'ready', journey });
  });

  it('says a trip is gone on 404, failed on any other error, and drops a cancelled request', () => {
    const http = (status: number) =>
      new ApiRequestError({ kind: 'http', status, code: null, message: null, requestId: null });
    expect(answerOfError(http(404))).toEqual({ kind: 'gone' });
    expect(answerOfError(http(500))).toEqual({ kind: 'failed' });
    expect(answerOfError(new ApiRequestError({ kind: 'network', timedOut: true }))).toEqual({
      kind: 'failed',
    });
    expect(answerOfError(new ApiRequestError({ kind: 'contract', path: '/x' }))).toEqual({
      kind: 'failed',
    });
    expect(answerOfError(new ApiRequestError({ kind: 'aborted' }))).toEqual({ kind: 'cancelled' });
    expect(() => answerOfError(new TypeError('bug'))).toThrow(TypeError);
  });

  it('settles the list: a gone trip leaves it, the others take their answer', () => {
    const journey = journeyFixture();
    const list: TripView[] = [
      { id: 'a', state: 'loading' },
      { id: 'b', state: 'loading' },
    ];
    const ready = settle(list, 'a', { kind: 'ready', journey });
    expect(ready[0]).toEqual({ id: 'a', state: 'ready', journey });
    expect(settle(ready, 'b', { kind: 'failed' })[1]).toEqual({ id: 'b', state: 'failed' });
    expect(settle(ready, 'b', { kind: 'gone' }).map((trip) => trip.id)).toEqual(['a']);
    expect(settle(ready, 'b', { kind: 'cancelled' })).toBe(ready);
  });

  it('reads a trip as watched with its status, finished or cancelled', () => {
    const journey = journeyFixture();
    expect(toneOf({ ...journey, state: 'watching' })).toBe(journey.watch.status);
    expect(toneOf({ ...journey, state: 'completed' })).toBe('completed');
    expect(toneOf({ ...journey, state: 'cancelled' })).toBe('cancelled');
  });
});
