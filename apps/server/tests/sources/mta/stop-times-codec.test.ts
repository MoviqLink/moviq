import { describe, expect, it } from 'vitest';

import {
  codeBuffer,
  codesOf,
  countCalls,
  readTrip,
  writeTrip,
} from '../../../src/modules/data-platform/sources/mta/stop-times-codec.js';

const trips = [
  {
    stop: [0, 3, 2],
    arrival: [21_600, 21_690, 21_780],
    departure: [21_600, 21_720, 21_780],
    flags: [1, 0, 2],
  },
  // Past 24:00, a stop met twice, and a departure before its arrival, kept as the file says.
  { stop: [5, 5], arrival: [90_000, 90_120], departure: [90_030, 90_100], flags: [3, 0] },
];

function encoded(): string {
  const buffer = codeBuffer();
  for (const trip of trips) writeTrip(buffer, trip);
  return buffer.text();
}

function decode(text: string, stopCount = 6) {
  const codes = codesOf(text);
  const counted = countCalls(codes);
  if (counted === undefined) return undefined;
  const into = {
    stop: new Int32Array(counted.calls),
    arrival: new Int32Array(counted.calls),
    departure: new Int32Array(counted.calls),
    flags: new Uint8Array(counted.calls),
  };
  const cursor = { at: 0 };
  let offset = 0;
  for (let trip = 0; trip < counted.trips; trip += 1) {
    const count = readTrip(codes, cursor, stopCount, into, offset);
    if (count < 0) return undefined;
    offset += count;
  }
  return { trips: counted.trips, ...into };
}

describe('stop times codec', () => {
  it('gives back every call of every trip, in the characters of an encoded polyline', () => {
    const text = encoded();
    expect(text).toMatch(/^[?-~]+$/);
    expect(decode(text)).toEqual({
      trips: 2,
      stop: Int32Array.from([0, 3, 2, 5, 5]),
      arrival: Int32Array.from([21_600, 21_690, 21_780, 90_000, 90_120]),
      departure: Int32Array.from([21_600, 21_720, 21_780, 90_030, 90_100]),
      flags: Uint8Array.from([1, 0, 2, 3, 0]),
    });
  });

  it.each([
    ['cut short', (text: string) => text.slice(0, -1), 6],
    [
      'with a character outside the format',
      (text: string) => `${text.slice(0, 3)} ${text.slice(4)}`,
      6,
    ],
    ['with a stop past the stops listed', (text: string) => text, 5],
    ['with an empty trip', () => '?', 6],
  ])('refuses text %s', (_, edit, stops) => {
    expect(decode(edit(encoded()), stops)).toBeUndefined();
  });
});
