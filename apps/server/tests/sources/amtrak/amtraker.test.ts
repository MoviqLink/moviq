import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { amtrakSources } from '../../../src/modules/data-platform/sources/amtrak/index.js';
import {
  accepted,
  capture,
  captureJson,
  findSource,
  json,
  storedAndRead,
  text,
} from '../regional/captures.js';

const amtraker = findSource(amtrakSources, 'amtraker-new-york');
/** The capture was downloaded at 03:20:59 UTC on 11/11/2026 (22:20 in New York). */
const RECEIVED_AT = new Date('2026-11-11T03:21:05Z');

const answerSchema = z.record(z.string(), z.array(z.record(z.string(), z.unknown())));

function parse(body: Uint8Array) {
  return amtraker.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

/** The capture with every train changed by `change`. */
function withTrains(change: (train: Record<string, unknown>) => void): Uint8Array {
  const answer = answerSchema.parse(captureJson('amtrak', 'amtraker-trains.json'));
  for (const train of Object.values(answer).flat()) change(train);
  return json(answer);
}

describe('Amtrak trains around New York (Amtraker)', () => {
  it('accepts the capture: the Amtrak trains between Trenton, Peekskill and Stamford', () => {
    const result = accepted(parse(capture('amtrak', 'amtraker-trains.json')));
    // The newest Amtrak batch: VIA Rail and Brightline trains, refreshed apart, do not count.
    expect(result.dataTime.toISOString()).toBe('2026-11-11T03:19:49.000Z');
    expect(result.coverage).toBe('5 trains around New York, 4 active, 0 left out');
    expect(storedAndRead(amtraker, result.data)).toEqual(result.data);
    expect(result.data).toMatchObject({
      notDeparted: 0,
      outsideArea: 3,
      otherNetworks: 2,
      leftOut: 0,
      trains: [
        {
          located: 'gps',
          trainId: '67-10',
          route: 'Northeast Regional',
          state: 'active',
          speedMph: 46.3941345214844,
          heading: 'SW',
          origin: { code: 'BOS', name: 'Boston South' },
          destination: { code: 'NPN', name: 'Newport News' },
          nextStation: { code: 'NRO', name: 'New Rochelle' },
          observedAt: '2026-11-11T03:19:40.000Z',
        },
        { trainId: '68-10', state: 'completed', observedAt: '2026-11-11T03:10:59.000Z' },
        { trainId: '243-10' },
        { trainId: '626-10' },
        { trainId: '1167-10' },
      ],
    });
  });

  it('counts the trains waiting to depart apart: they have no position of their own yet', () => {
    const body = withTrains((train) => {
      if (train['trainID'] !== '243-10') return;
      train['trainState'] = 'Predeparture';
      train['updatedAt'] = null;
    });
    const result = accepted(parse(body));
    expect(result.data).toMatchObject({ notDeparted: 1 });
    expect(result.coverage).toBe('4 trains around New York, 3 active, 0 left out');
  });

  it('leaves out a train in the area with a state it does not know', () => {
    const body = withTrains((train) => {
      if (train['trainID'] === '626-10') train['trainState'] = 'Cancelled';
    });
    expect(accepted(parse(body)).coverage).toBe('4 trains around New York, 3 active, 1 left out');
  });

  it.each([
    ['not-json', text('<html>error code: 1015</html>')],
    ['unexpected-shape', json([{ trainID: '67-10' }])],
    [
      'no-trains',
      withTrains((train) => {
        train['provider'] = 'Via';
      }),
    ],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('asks Amtraker for every train, with the generic identity of every request', () => {
    const request = amtraker.request({ credentials: {}, now: RECEIVED_AT });
    expect(request.url).toBe('https://api-v3.amtraker.com/v3/trains');
    expect(request.headers).toEqual({ accept: 'application/json' });
    expect(amtraker.licence.name).toBe('Open Data Commons Attribution License (ODC-By) 1.0');
  });
});
