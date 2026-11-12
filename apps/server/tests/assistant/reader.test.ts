import { describe, expect, it } from 'vitest';

import { readFlightNumber } from '../../src/modules/assistant/understanding/flight-number.js';
import { readSentence } from '../../src/modules/assistant/understanding/reader.js';
import { arrivalFrom, readClock } from '../../src/modules/assistant/understanding/time-words.js';

/** 07:00 on Wednesday 11 November 2026 in New York (EST, UTC-5). */
const NOW = new Date('2026-11-11T12:00:00.000Z');

const arrival = (text: string, now = NOW) => {
  const reading = readSentence(text, now);
  if (reading.clock === undefined) throw new Error(`no time in "${text}"`);
  return arrivalFrom(reading.clock, reading.day ?? null, now);
};

describe('the basic reader, in English', () => {
  it('reads a destination, a time and a start from one sentence', () => {
    const reading = readSentence('Bryant Park at 7 pm from 125th Street', NOW);
    expect(reading).toMatchObject({ plain: 'Bryant Park', origin: '125th Street' });
    expect(reading.destination).toBeUndefined();
    expect(arrival('Bryant Park at 7 pm from 125th Street')).toEqual({
      kind: 'at',
      at: new Date('2026-11-12T00:00:00.000Z'),
    });
  });

  it('reads a destination after a verb and the time before it', () => {
    const reading = readSentence('I need to be at Bryant Park by 7:30pm', NOW);
    expect(reading.destination).toBe('Bryant Park');
    expect(reading.clock).toMatchObject({ hour: 7, minute: 30, half: 'pm' });
  });

  it('reads "from … to …" in either order', () => {
    expect(readSentence('from 125th Street to Bryant Park', NOW)).toMatchObject({
      origin: '125th Street',
      destination: 'Bryant Park',
    });
  });

  it('settles the half of an hour from the words around it', () => {
    expect(readClock('at 7 in the evening')?.half).toBe('pm');
    expect(readClock('by 8 in the morning')?.half).toBe('am');
    expect(readClock('by 19:15')).toMatchObject({ hour: 19, minute: 15, half: 'h24' });
    expect(readClock('around noon')).toMatchObject({ hour: 12, minute: 0, half: 'h24' });
  });

  it('asks instead of guessing when an hour could be morning or evening', () => {
    expect(arrival('Bryant Park at 7')).toEqual({
      kind: 'ambiguous',
      pending: { day: null, hour: 7, minute: 0 },
    });
    expect(arrival('by 7:30').kind).toBe('ambiguous');
  });

  it('says a time has passed instead of moving it to another day', () => {
    expect(arrival('at 6:30 am')).toMatchObject({ kind: 'passed' });
    expect(arrival('today at 6 am')).toMatchObject({ kind: 'passed' });
  });

  it('reads days in New York, across the change of time', () => {
    const lateOctober = new Date('2026-10-31T16:00:00.000Z');
    expect(arrival('tomorrow at 9 am', lateOctober)).toEqual({
      kind: 'at',
      at: new Date('2026-11-01T14:00:00.000Z'),
    });
    expect(arrival('the day after tomorrow at 9 am')).toEqual({
      kind: 'at',
      at: new Date('2026-11-13T14:00:00.000Z'),
    });
  });

  it('plans up to a week ahead', () => {
    expect(arrivalFrom({ hour: 9, minute: 0, half: 'am' }, '2026-11-20', NOW)).toEqual({
      kind: 'too-far',
    });
  });

  it('reads a choice among the places offered', () => {
    expect(readSentence('the second one', NOW).choice).toBe(2);
    expect(readSentence('3', NOW).choice).toBe(3);
    expect(readSentence('in the evening', NOW).half).toBe('pm');
  });
});

describe('the basic reader, in Spanish', () => {
  it('reads a flight, its airport and the time said for it', () => {
    const reading = readSentence('al aeropuerto JFK para el vuelo DL 405 de las 10:00', NOW);
    expect(reading).toMatchObject({
      flight: { carrier: 'DL', number: '405' },
      airport: 'JFK',
      destination: 'aeropuerto JFK',
    });
    expect(reading.clock).toMatchObject({ hour: 10, minute: 0 });
  });

  it('reads a flight tomorrow and a street as the start', () => {
    expect(readSentence('Vuelo AA1234 mañana desde la calle 125', NOW)).toMatchObject({
      flight: { carrier: 'AA', number: '1234' },
      day: '2026-11-12',
      origin: '125 Street',
    });
  });

  it('reads a sentence with a destination, a 24-hour time and a start', () => {
    const text = 'Voy a Bryant Park, tengo que llegar a las 19:00, salgo de la calle 125';
    expect(readSentence(text, NOW)).toMatchObject({
      destination: 'Bryant Park',
      origin: '125 Street',
    });
    expect(arrival(text)).toEqual({ kind: 'at', at: new Date('2026-11-12T00:00:00.000Z') });
  });

  it('reads "de la tarde" and "por la mañana" without taking them for days', () => {
    expect(arrival('a Bryant Park a las 7 de la tarde')).toEqual({
      kind: 'at',
      at: new Date('2026-11-12T00:00:00.000Z'),
    });
    const morning = readSentence('mañana a las 9 por la mañana', NOW);
    expect(morning.day).toBe('2026-11-12');
    expect(morning.clock?.half).toBe('am');
  });

  it('asks when "a las 7" says neither morning nor evening', () => {
    expect(arrival('a Bryant Park a las 7').kind).toBe('ambiguous');
  });

  it('reads choices in Spanish', () => {
    expect(readSentence('la primera', NOW).choice).toBe(1);
    expect(readSentence('el segundo', NOW).choice).toBe(2);
    expect(readSentence('de la tarde', NOW).half).toBe('pm');
  });
});

describe('flight numbers written in any form', () => {
  it.each([
    ['AA1234', 'AA', '1234'],
    ['aa 1234', 'AA', '1234'],
    ['AA-1234 tomorrow', 'AA', '1234'],
    ['American 1234', 'AA', '1234'],
    ['vuelo DL 405', 'DL', '405'],
    ['flight ba117', 'BA', '117'],
    ['B6 123', 'B6', '123'],
    ['UA0123', 'UA', '123'],
    ['JBU 55', 'B6', '55'],
    ['Delta flight 88', 'DL', '88'],
  ])('%s is %s %s', (text, carrier, number) => {
    expect(readFlightNumber(text)).toMatchObject({ carrier, number });
  });

  it.each(['the M60 to LaGuardia', 'Bx12 at 7 pm', 'at 7pm', 'from 125th Street', 'a la 1'])(
    '"%s" holds no flight',
    (text) => {
      expect(readFlightNumber(text)).toBeUndefined();
    },
  );

  it('takes the day of the flight from the sentence', () => {
    expect(readSentence('AA-1234 tomorrow', NOW)).toMatchObject({
      flight: { carrier: 'AA', number: '1234' },
      day: '2026-11-12',
    });
  });
});
