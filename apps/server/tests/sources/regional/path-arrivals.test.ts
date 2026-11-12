import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  pathArrivalsSource,
  type PathArrivals,
} from '../../../src/modules/data-platform/sources/regional/path-arrivals.js';
import { accepted, capture, captureJson, json, storedAndRead, text } from './captures.js';

const source = pathArrivalsSource;
/** Downloaded at 02:24:46 UTC on 11/11/2026. */
const RECEIVED_AT = new Date('2026-11-11T02:24:46Z');

/** Only the fields the faults change; the others are kept as captured. */
const messageShape = z.looseObject({ secondsToArrival: z.string(), lastUpdated: z.string() });
const answerShape = z.object({
  results: z.array(
    z.looseObject({
      destinations: z.array(z.looseObject({ messages: z.array(messageShape) })),
    }),
  ),
});
type Answer = z.infer<typeof answerShape>;

function answer(): Answer {
  return answerShape.parse(captureJson('regional', 'path-ridepath.json'));
}

function parse(body: Uint8Array) {
  return source.parse(body, { receivedAt: RECEIVED_AT, previous: undefined });
}

/** The capture with its first message changed, the rest as captured. */
function withFirstMessage(change: Record<string, string>): Uint8Array {
  const changed = answer();
  const first = changed.results[0]?.destinations[0]?.messages[0];
  if (first) Object.assign(first, change);
  return json(changed);
}

describe('PATH arrivals', () => {
  it('accepts the capture at the newest update, with every station placed', () => {
    const result = accepted(parse(capture('regional', 'path-ridepath.json')));
    expect(result.dataTime.toISOString()).toBe('2026-11-11T02:23:38.873Z');
    expect(result.coverage).toBe('13 stations, 52 arrivals, 0 left out');
    expect(storedAndRead(source, result.data)).toEqual(result.data);
    const data = source.dataSchema.parse(result.data);
    expect(data.stations[0]).toMatchObject({ code: 'NWK', name: 'Newark', latitude: 40.73454 });
  });

  it('dates each arrival from the moment RidePATH counted it', () => {
    const data: PathArrivals = source.dataSchema.parse(
      accepted(parse(capture('regional', 'path-ridepath.json'))).data,
    );
    // Newark to WTC: 421 seconds after 21:22:58.758 in New York.
    expect(data.stations[0]?.arrivals[0]).toEqual({
      located: 'station',
      direction: 'to-new-york',
      destination: 'WTC',
      headsign: 'World Trade Center',
      lineColors: ['D93A30'],
      arrival: '2026-11-11T02:29:59.758Z',
      updatedAt: '2026-11-11T02:22:58.758Z',
    });
  });

  it('leaves out and counts an arrival without a whole number of seconds', () => {
    const result = accepted(parse(withFirstMessage({ secondsToArrival: '' })));
    expect(result.coverage).toBe('13 stations, 51 arrivals, 1 left out');
  });

  it.each([
    ['not-json', text('<html><body>Maintenance</body></html>')],
    ['unexpected-shape', json({ status: 'down' })],
    ['unexpected-shape', withFirstMessage({ lastUpdated: '21:22' })],
    ['unknown-station', withFirstMessage({ target: 'NJT' })],
    ['no-arrivals', json({ results: [{ consideredStation: 'NWK', destinations: [] }] })],
    ['future-update', withFirstMessage({ lastUpdated: '2026-11-10T21:40:00.000000-05:00' })],
  ])('refuses %s', (code, body) => {
    expect(parse(body)).toMatchObject({ ok: false, code });
  });

  it('refuses through its check an answer older than the one served', () => {
    const data: PathArrivals = source.dataSchema.parse(
      accepted(parse(capture('regional', 'path-ridepath.json'))).data,
    );
    const served = { ...data, updatedAt: '2026-11-11T02:30:00.000Z' };
    expect(source.check?.(data, served)).toEqual([expect.stringMatching(/^older-than-served: /)]);
    expect(source.check?.(data, data)).toEqual([]);
  });

  it('covers every code of its catalogue that is not an HTTP failure', () => {
    const codes = source.failures.map((failure) => failure.code);
    expect(codes).toEqual(
      expect.arrayContaining(['not-json', 'unexpected-shape', 'unknown-station', 'no-arrivals']),
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('asks panynj.gov for the RidePATH JSON', () => {
    expect(source.request({ credentials: {}, now: RECEIVED_AT })).toEqual({
      url: 'https://www.panynj.gov/bin/portauthority/ridepath.json',
      headers: { accept: 'application/json' },
    });
  });
});
