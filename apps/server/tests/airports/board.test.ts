import { airportBoardSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  AERODATABOX_ATTRIBUTION,
  createAirportBoardService,
} from '../../src/modules/airports/board.js';
import { manualClock } from '../support/manual-clock.js';
import {
  ADSB_AT,
  currentReading,
  fakeReader,
  jfkSnapshot,
  jfkTraffic,
  stubBoards,
  USUAL_ROUTES,
} from './support.js';

const NOW = new Date(ADSB_AT.getTime() + 60_000);

/** The FAA status as its schema holds it: a ground stop at JFK, nothing at the others. */
const faa = {
  updatedAt: '2026-11-11T05:42:00.000Z',
  airports: [
    { code: 'JFK', programs: [{ kind: 'ground-stop', reason: 'weather', until: '1:30 am EST' }] },
    { code: 'LGA', programs: [] },
    { code: 'EWR', programs: [] },
  ],
};

const sources = {
  'adsb-lol-new-york': jfkTraffic(),
  'adsb-fi-new-york': jfkTraffic(),
  'adsb-routes': { routes: USUAL_ROUTES, leftOut: 0 },
  'faa-airport-status': faa,
};

function service(data: Readonly<Record<string, unknown>>, states = {}, withBoard = true) {
  const { boards } = stubBoards(withBoard ? { JFK: currentReading(jfkSnapshot()) } : {}, NOW);
  return createAirportBoardService({
    boards,
    reader: fakeReader(data, NOW, states),
    clock: manualClock(NOW.toISOString()),
  });
}

describe('the airport board service', () => {
  it('serves the board in the public contract, with ADS-B, the FAA and the attribution', async () => {
    const board = await service(sources).board('JFK', 'departures');
    expect(airportBoardSchema.parse(JSON.parse(JSON.stringify(board)))).toEqual(board);
    expect(board).toMatchObject({
      airport: { code: 'JFK', icao: 'KJFK', name: 'John F. Kennedy International' },
      direction: 'departures',
      snapshot: {
        state: 'current',
        takenAt: '2026-11-11T05:39:49.000Z',
        window: { from: '2026-11-11T03:39:49.000Z', to: '2026-11-11T15:39:49.000Z' },
        nextRefreshAt: '2026-11-11T08:39:49.000Z',
      },
      faa: { programs: [{ kind: 'ground-stop', reason: 'weather' }] },
    });
    expect(board.flights).toHaveLength(14);
    expect(board.flights.find((flight) => flight.number === 'AV 245')?.live?.phase).toBe(
      'departed',
    );
    expect(board.attribution).toEqual([
      AERODATABOX_ATTRIBUTION,
      'Aircraft positions from adsb.lol, available under the ODbL 1.0',
      'Usual routes from the Virtual Radar Server standing data (CC0)',
      'Federal Aviation Administration, NAS Status',
    ]);
    expect(AERODATABOX_ATTRIBUTION).toBe('Flight data by AeroDataBox');
    expect(board.aircraft.sources.map((source) => source.sourceId)).toEqual([
      'adsb-lol-new-york',
      'adsb-fi-new-york',
      'adsb-routes',
    ]);
  });

  it('never takes an FAA status it cannot read as no delays', async () => {
    const { 'faa-airport-status': _faa, ...rest } = sources;
    const board = await service(rest).board('JFK', 'arrivals');
    expect(board.faa).toMatchObject({ programs: null, provenance: { state: 'unavailable' } });
  });

  it('with ADS-B down shows the board alone and says why nothing moves on it', async () => {
    const board = await service({ 'faa-airport-status': faa }).board('JFK', 'arrivals');
    expect(board.flights.every((flight) => flight.live === null)).toBe(true);
    expect(board.aircraft.unmatched).toEqual([]);
    expect(board.aircraft.sources.map((source) => source.state)).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
    ]);
  });

  it('reads adsb.fi when adsb.lol is stale, and credits it', async () => {
    const board = await service(sources, { 'adsb-lol-new-york': 'stale' }).board(
      'JFK',
      'departures',
    );
    expect(board.attribution[1]).toBe('Aircraft positions from adsb.fi (https://adsb.fi)');
    expect(
      board.flights.find((flight) => flight.number === 'JL 3')?.live?.provenance.sourceId,
    ).toBe('adsb-fi-new-york');
  });

  it('without a board lists the aircraft moving and says there is none to compare with', async () => {
    const board = await service(sources, {}, false).board('JFK', 'departures');
    expect(board.snapshot).toMatchObject({ state: 'none', takenAt: null, window: null });
    expect(board.flights).toEqual([]);
    expect(board.aircraft.unmatched.every((plane) => plane.reason === 'no-board')).toBe(true);
  });
});
