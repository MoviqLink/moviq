import { describe, expect, it } from 'vitest';

import { resolveIntegrations } from '../../src/config/integrations.js';
import { Secret } from '../../src/config/secret.js';
import { GENERIC_USER_AGENT } from '../../src/infrastructure/http/client.js';
import { fidsUrl } from '../../src/modules/data-platform/on-demand/aerodatabox-fids.js';
import {
  createAeroDataBoxGateway,
  type AeroDataBoxCredential,
} from '../../src/modules/data-platform/on-demand/aerodatabox-gateway.js';
import { createAeroDataBoxFlights } from '../../src/modules/data-platform/on-demand/aerodatabox.js';
import {
  createUnitAllowance,
  type UnitAllowance,
} from '../../src/modules/data-platform/on-demand/aerodatabox-units.js';
import { createAirportBoards } from '../../src/modules/data-platform/on-demand/airport-boards.js';
import { createBoardBudget } from '../../src/modules/data-platform/on-demand/board-budget.js';
import { createOnDemandProviders } from '../../src/modules/data-platform/on-demand/index.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import { capture, stubHttp, type StubAnswer } from '../on-demand/support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const BOARD = capture('aerodatabox-fids-kjfk.json');

/** RapidAPI's count after the JFK capture: 394 units left, the month restarting in 29.9 days. */
const GATEWAY = {
  'x-ratelimit-api-units-remaining': '394',
  'x-ratelimit-api-units-reset': '2584735',
};

function boardsOver(
  answer: StubAnswer | 'network-down',
  options: {
    readonly clock?: ManualClock;
    readonly units?: UnitAllowance;
    readonly credential?: AeroDataBoxCredential;
  } = {},
) {
  const { http, sent } = stubHttp(answer);
  const clock = options.clock ?? manualClock('2026-11-11T05:39:49Z');
  const units = options.units ?? createUnitAllowance();
  const gateway = createAeroDataBoxGateway({
    http,
    clock,
    credential: options.credential ?? { key: new Secret('test-key') },
    units,
    spacingMs: 0,
  });
  const boards = createAirportBoards({ gateway, budget: createBoardBudget(units), clock });
  return { boards, sent, clock, units, gateway };
}

describe('the airport boards', () => {
  it('asks nothing until a board is read, then the documented request with the generic identity', async () => {
    const { boards, sent, units, clock } = boardsOver({ body: BOARD, headers: GATEWAY });
    expect(sent).toEqual([]);
    const reading = await boards.read('JFK');
    expect(reading).toMatchObject({ state: 'current', provenance: { state: 'healthy' } });
    expect(reading.snapshot?.departures).toHaveLength(14);
    expect(reading.nextRefreshAt).toEqual(new Date('2026-11-11T08:39:49Z'));
    expect(sent.map((request) => request.url)).toEqual([fidsUrl('JFK')]);
    expect(sent[0]?.headers.get('user-agent')).toBe(GENERIC_USER_AGENT);
    expect(sent[0]?.headers.get('x-rapidapi-key')).toBe('test-key');
    expect(units.spendable(clock.now())).toBe(354);
  });

  it('refreshes each airport at most every 3 hours, and once for readers asking at once', async () => {
    const { boards, sent, clock } = boardsOver({ body: BOARD });
    await Promise.all([boards.read('JFK'), boards.read('JFK'), boards.read('JFK')]);
    expect(sent).toHaveLength(1);
    clock.advance(2 * HOUR + 59 * MINUTE);
    expect(await boards.read('JFK')).toMatchObject({ state: 'current' });
    expect(sent).toHaveLength(1);
    await boards.read('LGA');
    expect(sent.map((request) => request.url)).toEqual([fidsUrl('JFK'), fidsUrl('LGA')]);
    clock.advance(MINUTE);
    await boards.read('JFK');
    expect(sent).toHaveLength(3);
  });

  it('with the provider down says so, keeps the last board with its time, and waits 15 minutes', async () => {
    const clock = manualClock('2026-11-11T05:39:49Z');
    const units = createUnitAllowance();
    const good = boardsOver({ body: BOARD }, { clock, units });
    const first = await good.boards.read('JFK');
    expect(first.state).toBe('current');
    const { boards, sent } = boardsOver({ status: 503 }, { clock, units });
    expect(await boards.read('JFK')).toMatchObject({
      state: 'none',
      provenance: {
        state: 'unavailable',
        evidence: 'No board yet. AeroDataBox failed to answer (HTTP 503).',
      },
    });
    expect(sent).toHaveLength(1);
    clock.advance(10 * MINUTE);
    expect((await boards.read('JFK')).state).toBe('none');
    expect(sent).toHaveLength(1);
    clock.advance(5 * MINUTE);
    await boards.read('JFK');
    expect(sent).toHaveLength(2);
  });

  it('keeps a board past its 3 hours when the next request fails, marked with its time', async () => {
    const answers: StubAnswer[] = [{ body: BOARD }, { status: 500 }];
    const clock = manualClock('2026-11-11T05:39:49Z');
    const units = createUnitAllowance();
    const sent: string[] = [];
    const gateway = createAeroDataBoxGateway({
      http: {
        get: (request) => {
          sent.push(request.url);
          const answer = answers[sent.length - 1] ?? { status: 500 };
          return stubHttp(answer).http.get(request);
        },
        send: (request) => stubHttp({ status: 500 }).http.send(request),
      },
      clock,
      credential: { key: new Secret('test-key') },
      units,
      spacingMs: 0,
    });
    const boards = createAirportBoards({ gateway, budget: createBoardBudget(units), clock });
    await boards.read('JFK');
    clock.advance(4 * HOUR);
    const kept = await boards.read('JFK');
    expect(kept).toMatchObject({
      state: 'kept',
      snapshot: { takenAt: new Date('2026-11-11T05:39:49Z') },
      provenance: {
        dataTime: '2026-11-11T05:39:49.000Z',
        ageSeconds: 4 * 3600,
        state: 'unavailable',
        evidence:
          'Board of 2026-11-11T05:39:49.000Z kept. AeroDataBox failed to answer (HTTP 500).',
      },
      nextRefreshAt: new Date('2026-11-11T09:54:49Z'),
    });
    // AeroDataBox's terms allow 7 days: an older board is no longer served.
    clock.advance(7 * DAY);
    expect(await boards.read('JFK')).toMatchObject({ state: 'none', snapshot: null });
  });

  it('without the key sends nothing and says what to set', async () => {
    const { boards, sent } = boardsOver(
      { body: BOARD },
      { credential: { missing: ['AERODATABOX_KEY'] } },
    );
    expect(await boards.read('EWR')).toMatchObject({
      state: 'none',
      nextRefreshAt: null,
      provenance: {
        state: 'misconfigured',
        evidence: 'No board yet. Set AERODATABOX_KEY to look up airport boards.',
      },
    });
    expect(sent).toEqual([]);
  });
});

describe('one count of units for boards and flights', () => {
  it('builds the boards on the same units and gateway as the flights', async () => {
    const { http, sent } = stubHttp({ body: BOARD, headers: { ...GATEWAY } });
    const providers = createOnDemandProviders({
      http,
      clock: manualClock('2026-11-11T05:39:49Z'),
      integrations: resolveIntegrations({ AERODATABOX_KEY: 'test-key' }),
    });
    expect((await providers.boards.read('JFK')).state).toBe('current');
    // The gateway now says 394 are left: 354 above the reserve, so a flight still goes out.
    await providers.flights.find({ carrier: 'AA', number: '100', date: '2026-11-11' });
    expect(sent).toHaveLength(2);
  });

  it('leaves the traveller reserve to flights: boards stop at 100 units, flights go on', async () => {
    const clock = manualClock('2026-11-11T05:39:49Z');
    const units = createUnitAllowance();
    units.observe(
      new Headers({
        'x-ratelimit-api-units-remaining': '141',
        'x-ratelimit-api-units-reset': '2584735',
      }),
      clock.now(),
    );
    const { boards, sent, gateway } = boardsOver({ body: BOARD }, { clock, units });
    const refused = await boards.read('JFK');
    expect(refused).toMatchObject({
      state: 'none',
      nextRefreshAt: new Date('2026-12-11T03:38:44Z'),
      provenance: {
        state: 'rate_limited',
        evidence:
          "No board yet. Only 1 units are left above the 100 kept for travellers' flights: " +
          'boards wait for the month to renew. The next one may be taken from ' +
          '2026-12-11T03:38:44.000Z.',
      },
    });
    expect(sent).toEqual([]);
    const flights = createAeroDataBoxFlights(gateway);
    await flights.find({ carrier: 'AA', number: '100', date: '2026-11-11' });
    expect(sent).toHaveLength(1);
  });

  it('sends one request a second across boards and flights', async () => {
    const { http, sent } = stubHttp({ body: '[]' });
    const clock = manualClock('2026-11-11T05:39:49Z');
    const units = createUnitAllowance();
    const gateway = createAeroDataBoxGateway({
      http,
      clock,
      credential: { key: new Secret('test-key') },
      units,
      spacingMs: 120,
    });
    const boards = createAirportBoards({ gateway, budget: createBoardBudget(units), clock });
    const flights = createAeroDataBoxFlights(gateway);
    const started = Date.now();
    await Promise.all([
      boards.read('JFK'),
      flights.find({ carrier: 'AA', number: '100', date: '2026-11-11' }),
    ]);
    expect(sent).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(115);
  });
});
