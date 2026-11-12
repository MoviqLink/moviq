import { describe, expect, it } from 'vitest';

import { buildOverlay } from '../../../src/modules/journeys/engine/live.js';
import { compileNetwork } from '../../../src/modules/journeys/engine/network.js';
import type { SearchRequest } from '../../../src/modules/journeys/engine/labels.js';
import { runRaptor } from '../../../src/modules/journeys/engine/raptor.js';
import { searchCalendar } from '../../../src/modules/journeys/engine/service-days.js';
import { handTimetable, provenance, seconds, tuesday, type HandTrip } from './hand-network.js';

const TRIPS: readonly HandTrip[] = [
  {
    id: 'slow',
    route: 'S',
    calls: [
      ['A', '07:30'],
      ['D', '08:20'],
    ],
  },
  {
    id: 'fast1',
    route: 'F1',
    calls: [
      ['A', '07:50'],
      ['B', '07:55'],
    ],
  },
  {
    id: 'fast2',
    route: 'F2',
    calls: [
      ['B', '07:57'],
      ['D', '08:15'],
    ],
  },
];

function request(deadline: string): SearchRequest {
  const network = compileNetwork([
    {
      sourceId: 'hand-gtfs',
      version: 'v1',
      provenance: provenance('hand-gtfs'),
      timetable: handTimetable(TRIPS),
    },
  ]);
  const calendar = searchCalendar(network.services, tuesday(deadline));
  if (calendar === undefined) throw new Error('no calendar');
  const stop = (id: string): number => network.stops.ids.indexOf(id);
  // Tuesday is the second service day of the search: its times are one day after the epoch.
  const tuesdaySeconds = (clock: string): number => 86_400 + seconds(clock);
  return {
    network,
    calendar,
    overlay: buildOverlay(network, calendar, []),
    patterns: new Uint8Array(network.patterns.count).fill(1),
    stops: null,
    footpaths: network.footpaths,
    access: [{ stop: stop('A'), seconds: 0 }],
    egress: [{ stop: stop('D'), seconds: 0 }],
    deadline: tuesdaySeconds(deadline),
    earliest: tuesdaySeconds('06:00'),
    maxRides: 4,
  };
}

describe('RAPTOR rounds', () => {
  it('give one origin departure per number of rides, each later than with fewer', () => {
    const { front } = runRaptor(request('08:25'));
    expect(front.map(({ rides, departure }) => [rides, departure - 86_400])).toEqual([
      [1, seconds('07:30')],
      [2, seconds('07:50')],
    ]);
  });

  it('never borrow a trip of another pattern when none of a pattern arrives in time', () => {
    const search = request('08:14:59');
    const { front, labels } = runRaptor(search);
    expect(front).toEqual([]);
    expect([...(labels.board[1] ?? [])].every((label) => label === -2_147_483_648)).toBe(true);
  });
});
