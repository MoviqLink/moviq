import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EventList } from '../../../src/modules/data-platform/sources/events/event-data.js';
import { eventListSchema } from '../../../src/modules/data-platform/sources/events/event-data.js';
import { nycParksEventsSource } from '../../../src/modules/data-platform/sources/events/nyc-parks.js';
import { admitted, bytes, capture, codeOf, RECEIVED, text } from './fixtures.js';

const source = nycParksEventsSource;
const rows = z
  .array(z.looseObject({ guid: z.string() }))
  .parse(JSON.parse(text('nyc-parks-events.json')));

const parse = (body: Uint8Array, previous?: EventList) =>
  source.parse(body, { receivedAt: RECEIVED.parks, previous });

const row = (guid: string): Record<string, unknown> => {
  const found = rows.find((candidate) => candidate.guid === guid);
  if (found === undefined) throw new Error(`No row ${guid}`);
  return found;
};

describe('NYC Parks public events', () => {
  it('accepts the real capture dated by its load, not by the download', () => {
    const result = parse(capture('nyc-parks-events.json'));
    expect(result).toMatchObject({
      ok: true,
      dataTime: new Date('2026-11-10T14:09:58.798Z'),
      coverage: '10 events, 2 left out',
    });
    const data = admitted(result);
    expect(data.excluded).toEqual([
      { reason: 'no-start-time', count: 1 },
      { reason: 'no-venue', count: 1 },
    ]);
    expect(eventListSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('reads starttime and endtime as New York times', () => {
    const fitness = admitted(parse(capture('nyc-parks-events.json'))).events.find(
      (event) => event.id === '2218038',
    );
    // "2026-11-10T07:30:00.000" in the capture: 07:30 EST.
    expect(fitness).toMatchObject({
      name: 'Forest Fitness',
      category: 'fitness',
      startsAt: '2026-11-10T12:30:00.000Z',
      endsAt: '2026-11-10T13:30:00.000Z',
      venue: { name: 'Margaret Corbin Circle (in Fort Tryon Park)', address: null },
      officialUrl: 'http://www.nycgovparks.org/events/2026/11/10/forest-fitness',
    });
  });

  it('takes the first of several places, with its own coordinates', () => {
    const run = admitted(parse(capture('nyc-parks-events.json'))).events.find(
      (event) => event.id === '2096752',
    );
    expect(run?.venue).toEqual({
      name: 'Entrance to John Golden Park (in John Golden Park)',
      address: null,
      lat: 40.773001879825,
      lon: -73.769996166229,
    });
  });

  it('reads a cancellation from the title, where Parks writes it', () => {
    const events = admitted(parse(capture('nyc-parks-events.json'))).events;
    expect(events.find((event) => event.id === '2112376')).toMatchObject({
      name: 'Team RIVER Volunteers',
      status: 'cancelled',
    });
    expect(events.find((event) => event.id === '2112377')?.status).toBe('scheduled');
  });

  it('maps the categories from the most specific one', () => {
    const events = admitted(parse(capture('nyc-parks-events.json'))).events;
    const category = (id: string) => events.find((event) => event.id === id)?.category;
    expect(category('2234598')).toBe('music');
    expect(category('2219595')).toBe('festival');
    expect(category('2282506')).toBe('family');
    expect(category('2112377')).toBe('outdoors');
  });

  it('asks for the fields it reads, ordered by guid', () => {
    const query = new URL(source.request({ credentials: {}, now: RECEIVED.parks }).url)
      .searchParams;
    expect(Object.fromEntries(query)).toEqual({
      $select:
        ':updated_at,guid,title,link,starttime,endtime,location,parknames,coordinates,categories',
      $order: 'guid',
      $limit: '5000',
    });
  });

  it('refuses what it cannot read, an empty list and a sudden drop', () => {
    expect(codeOf(parse(bytes('<html>Down</html>')))).toBe('not-json');
    expect(codeOf(parse(bytes([{ guid: 'x' }])))).toBe('unexpected-shape');
    expect(codeOf(parse(bytes([])))).toBe('empty');
    const full = admitted(parse(capture('nyc-parks-events.json')));
    const one = admitted(parse(bytes([row('2218038')])));
    expect(source.check?.(one, full)).toEqual(['coverage-drop: 1 events, 10 before']);
    expect(source.check?.(full, one)).toEqual([]);
    const codes = source.failures.map((failure) => failure.code);
    expect(codes.slice(0, 4)).toEqual(['not-json', 'unexpected-shape', 'empty', 'coverage-drop']);
  });
});
