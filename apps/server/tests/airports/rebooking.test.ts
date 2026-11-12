import { describe, expect, it } from 'vitest';

import type { AirportSnapshot } from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import { nextDepartures } from '../../src/modules/airports/rebooking.js';
import { BOARD_TAKEN_AT, currentReading, jfkSnapshot, stubBoards } from './support.js';

const NOW = new Date('2026-11-11T05:40:00Z');

/** A Newark board of test values, with the fields AeroDataBox gives (not a capture). */
function newark(): AirportSnapshot {
  const jfk = jfkSnapshot();
  const template = jfk.departures.find((flight) => flight.number === 'T5 159');
  if (template === undefined) throw new Error('T5 159 is on the JFK board of the tests');
  const at = (scheduledAt: string, number: string, status: 'Expected' | 'Canceled') => ({
    ...template,
    id: `${number}@${scheduledAt}`,
    number,
    scheduledAt,
    revisedAt: null,
    status,
  });
  return {
    ...jfk,
    code: 'EWR',
    departures: [
      at('2026-11-11T07:00:00.000Z', 'UA 1', 'Canceled'),
      at('2026-11-11T08:00:00.000Z', 'UA 2', 'Expected'),
    ],
    arrivals: [],
  };
}

describe('the next departures to the same destination, for the ticket simulator', () => {
  it('lists the departures after the missed one from the three airports, soonest first', async () => {
    const { boards, asked } = stubBoards(
      { JFK: currentReading(jfkSnapshot()), EWR: currentReading(newark()) },
      NOW,
    );
    const next = await nextDepartures(
      boards,
      { destination: 'hnd', after: new Date('2026-11-11T05:35:00Z'), number: 'JL 3' },
      NOW,
    );
    expect(asked.sort()).toEqual(['EWR', 'JFK', 'LGA']);
    expect(
      next.departures.map((departure) => [departure.airport, departure.flight.number]),
    ).toEqual([
      ['JFK', 'T5 159'],
      ['EWR', 'UA 2'],
    ]);
    expect(next.departures[0]).toMatchObject({
      departsAt: '2026-11-11T05:50:00.000Z',
      flight: { airport: { iata: 'HND' }, provenance: { sourceId: 'aerodatabox' } },
    });
    expect(next.coverage).toEqual([
      expect.objectContaining({
        airport: 'JFK',
        state: 'current',
        coveredUntil: new Date(BOARD_TAKEN_AT.getTime() + 10 * 60 * 60_000).toISOString(),
      }),
      expect.objectContaining({ airport: 'LGA', state: 'none', coveredUntil: null }),
      expect.objectContaining({ airport: 'EWR', state: 'current' }),
    ]);
  });

  it('offers once a departure AeroDataBox lists under two airlines of a group', async () => {
    const { boards } = stubBoards({ JFK: currentReading(jfkSnapshot()) }, NOW);
    const next = await nextDepartures(
      boards,
      { destination: 'GYE', after: new Date('2026-11-11T06:00:00Z'), number: null },
      NOW,
    );
    expect(
      next.departures.map((departure) => [
        departure.flight.number,
        departure.flight.terminal,
        departure.alsoListedAs,
      ]),
    ).toEqual([
      ['T7 7393', '4', ['T8 7393']],
      ['T9 1453', '4', ['U1 1453']],
    ]);
    // Missing T9 1453 leaves out U1 1453 too: it is the same departure.
    const missed = await nextDepartures(
      boards,
      { destination: 'GYE', after: new Date('2026-11-11T06:00:00Z'), number: 'T9 1453' },
      NOW,
    );
    expect(missed.departures.map((departure) => departure.flight.number)).toEqual(['T7 7393']);
  });

  it('never offers a flight already gone, or one before the traveller can take it', async () => {
    const { boards } = stubBoards({ JFK: currentReading(jfkSnapshot()) }, NOW);
    const later = await nextDepartures(
      boards,
      { destination: 'TPE', after: new Date('2026-11-11T05:00:00Z'), number: null },
      NOW,
    );
    // BR 31 and T6 11 to Taipei have both departed.
    expect(later.departures).toEqual([]);
    const gone = await nextDepartures(
      boards,
      { destination: 'HND', after: new Date('2026-11-11T06:00:00Z'), number: null },
      NOW,
    );
    expect(gone.departures).toEqual([]);
  });
});
