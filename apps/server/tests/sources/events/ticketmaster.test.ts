import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { credentialsFrom } from '../../../src/modules/data-platform/credentials.js';
import { resolveIntegrations } from '../../../src/config/integrations.js';
import { assess, NO_FACTS } from '../../../src/modules/data-platform/health.js';
import { planNextRun } from '../../../src/modules/data-platform/schedule.js';
import { eventListSchema } from '../../../src/modules/data-platform/sources/events/event-data.js';
import {
  officialPageOf,
  parseEventSearch,
} from '../../../src/modules/data-platform/sources/events/ticketmaster.js';
import {
  ticketmasterSources,
  windowAhead,
} from '../../../src/modules/data-platform/sources/events/ticketmaster-windows.js';
import { admitted, bytes, capture, codeOf, RECEIVED, text } from './fixtures.js';

const page = z
  .looseObject({
    _embedded: z.looseObject({ events: z.array(z.looseObject({ id: z.string() })) }),
    page: z.looseObject({ totalElements: z.number() }),
  })
  .parse(JSON.parse(text('ticketmaster-events.json')));

const parse = (body: Uint8Array) => parseEventSearch(body, RECEIVED.ticketmaster);

/** The answer of the tests with its events replaced, everything else as written. */
const withEvents = (events: readonly unknown[]) => bytes({ ...page, _embedded: { events } });

const eventById = (id: string): Record<string, unknown> => {
  const event = page._embedded.events.find((candidate) => candidate.id === id);
  if (event === undefined) throw new Error(`No event ${id} in the answer of the tests`);
  return event;
};

describe('Ticketmaster Discovery API, Event Search', () => {
  it('normalises the answer and says the page holds fewer events than the provider', () => {
    const result = parse(capture('ticketmaster-events.json'));
    expect(result).toMatchObject({
      ok: true,
      dataTime: RECEIVED.ticketmaster,
      coverage: '9 events, 3 left out; 12 of 247 handed over',
    });
    const data = admitted(result);
    expect(data.complete).toBe(false);
    expect(data.excluded).toEqual([
      { reason: 'long-running', count: 2 },
      { reason: 'no-start-time', count: 1 },
    ]);
    expect(eventListSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('keeps venue, start, category and the official page as the API gives them', () => {
    const knicks = admitted(parse(capture('ticketmaster-events.json'))).events.find(
      (event) => event.id === 'tm-test-08',
    );
    expect(knicks).toMatchObject({
      name: 'Home team vs. visitors (test)',
      category: 'sports',
      sourceCategories: ['Sports', 'Basketball', 'NBA'],
      status: 'scheduled',
      startsAt: '2026-11-12T00:00:00.000Z',
      endsAt: null,
      venue: { name: 'Madison Square Garden', lat: 40.7497062, lon: -73.9916006 },
    });
    expect(knicks?.officialUrl).toBe(
      'https://www.ticketmaster.com/basketball-home-team-vs-visitors/event/TEST0008',
    );
  });

  it('links every event to its own page, never through the click tracker', () => {
    const events = admitted(parse(capture('ticketmaster-events.json'))).events;
    for (const event of events) expect(new URL(event.officialUrl).hostname).not.toMatch(/evyy/);
    const wrapped =
      'https://ticketmaster.evyy.net/c/1234567/264167/4272?u=https%3A%2F%2Fwww.ticketmaster.com%2Fevent%2FX1';
    expect(officialPageOf(wrapped)).toBe('https://www.ticketmaster.com/event/X1');
    expect(officialPageOf('https://ticketmaster.evyy.net/c/1/2/3')).toBeUndefined();
    expect(officialPageOf('https://www.ticketweb.com/event/a')).toBe(
      'https://www.ticketweb.com/event/a',
    );
    expect(officialPageOf('javascript:alert(1)')).toBeUndefined();
  });

  it('reads a cancellation from the status code, in either spelling', () => {
    const events = admitted(parse(capture('ticketmaster-events.json'))).events;
    expect(events.find((event) => event.id === 'tm-test-10')?.status).toBe('cancelled');
    const knicks = eventById('tm-test-08');
    const dates = z.looseObject({}).parse(knicks['dates']);
    const canceled = { ...knicks, dates: { ...dates, status: { code: 'canceled' } } };
    expect(admitted(parse(withEvents([canceled]))).events[0]?.status).toBe('cancelled');
  });

  it('never completes a time or a place the API does not give', () => {
    const knicks = eventById('tm-test-08');
    const dates = z.looseObject({ start: z.looseObject({}) }).parse(knicks['dates']);
    const embedded = z
      .looseObject({ venues: z.array(z.looseObject({})) })
      .parse(knicks['_embedded']);
    const [venue = {}] = embedded.venues;
    const cases = [
      { ...knicks, dates: { ...dates, start: { ...dates.start, timeTBA: true } } },
      { ...knicks, _embedded: { venues: [{ ...venue, location: undefined }] } },
      {
        ...knicks,
        _embedded: { venues: [{ ...venue, location: { latitude: '25.81', longitude: '-80.33' } }] },
      },
      { ...knicks, url: undefined },
      { ...knicks, test: true },
      { name: 'No id' },
    ];
    expect(admitted(parse(withEvents(cases))).excluded).toEqual([
      { reason: 'no-start-time', count: 1 },
      { reason: 'no-venue', count: 1 },
      { reason: 'outside-area', count: 1 },
      { reason: 'no-official-link', count: 1 },
      { reason: 'test-event', count: 1 },
      { reason: 'unreadable', count: 1 },
    ]);
  });

  it('serves an empty answer as complete and refuses one it cannot read', () => {
    const empty = bytes({
      _links: {},
      page: { size: 200, totalElements: 0, totalPages: 0, number: 0 },
    });
    expect(admitted(parse(empty))).toMatchObject({ events: [], complete: true, providerTotal: 0 });
    expect(codeOf(parse(bytes('<html>Bad gateway</html>')))).toBe('not-json');
    expect(codeOf(parse(bytes({ events: [] })))).toBe('unexpected-shape');
    expect(codeOf(parse(withEvents([{ name: 'a' }, { name: 'b' }])))).toBe('unexpected-shape');
  });
});

describe('Ticketmaster windows', () => {
  it('splits seven days into day and night parts of New York time', () => {
    // 23:40 on 10/11/2026 in New York: the night part that began at 17:00.
    const now = RECEIVED.ticketmaster;
    expect(windowAhead(now, 0)).toEqual({
      start: new Date('2026-11-10T22:00:00Z'),
      end: new Date('2026-11-11T10:00:00Z'),
    });
    expect(windowAhead(now, 1).end).toEqual(new Date('2026-11-11T22:00:00Z'));
    expect(windowAhead(now, 13).end).toEqual(new Date('2026-11-17T22:00:00Z'));
    expect(windowAhead(new Date('2026-11-11T08:00:00Z'), 0).start).toEqual(
      new Date('2026-11-10T22:00:00Z'),
    );
  });

  it('keeps 05:00 and 17:00 across the change of the clocks', () => {
    // 17:00 EDT on 31/10/2026; clocks go back at 02:00 on 01/11.
    const window = windowAhead(new Date('2026-10-31T21:00:00Z'), 0);
    expect(window).toEqual({
      start: new Date('2026-10-31T21:00:00Z'),
      end: new Date('2026-11-01T10:00:00Z'),
    });
  });

  it('asks for one page of 200 around Times Square, the key only in the request', () => {
    const [first] = ticketmasterSources;
    if (first === undefined) throw new Error('No window');
    const { url } = first.request({
      credentials: { TICKETMASTER_API_KEY: 'k-1' },
      now: RECEIVED.ticketmaster,
    });
    const query = new URL(url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      apikey: 'k-1',
      geoPoint: 'dr5ru7',
      radius: '25',
      unit: 'miles',
      startDateTime: '2026-11-10T22:00:00Z',
      endDateTime: '2026-11-11T10:00:00Z',
      size: '200',
      sort: 'date,asc',
      locale: '*',
    });
  });

  it('stays well inside the daily quota, one window at a time', () => {
    const ids = ticketmasterSources.map((source) => source.id);
    expect(new Set(ids).size).toBe(14);
    const perDay = ticketmasterSources.reduce(
      (total, source) => total + 86_400_000 / source.rhythm.baseIntervalMs,
      0,
    );
    expect(perDay).toBe(176);
    expect(ticketmasterSources.every((source) => source.kind === 'static')).toBe(true);
  });

  it('without TICKETMASTER_API_KEY is misconfigured and makes no request', () => {
    const { missingVariables } = credentialsFrom(resolveIntegrations({}));
    for (const source of ticketmasterSources) {
      const missing = missingVariables(source);
      expect(missing).toEqual(['TICKETMASTER_API_KEY']);
      const plan = planNextRun(source, NO_FACTS, {
        now: RECEIVED.ticketmaster,
        interested: false,
        missingVariables: missing,
        random: () => 0.5,
      });
      expect(plan.reason).toBe('never');
      expect(assess(source, NO_FACTS, RECEIVED.ticketmaster, missing)).toMatchObject({
        state: 'misconfigured',
        evidence: 'Needs TICKETMASTER_API_KEY, which is not set.',
      });
    }
  });

  it('lists every refusal it can give', () => {
    const [first] = ticketmasterSources;
    expect(first?.failures.map((failure) => failure.code)).toEqual([
      'missing-credential',
      'not-json',
      'unexpected-shape',
      'http-429',
      'http-503',
      'timeout',
      'http-403',
      'too-large',
    ]);
  });
});
