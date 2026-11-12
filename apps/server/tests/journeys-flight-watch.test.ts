import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../src/infrastructure/database/database.js';
import { migrate, readMigrations } from '../src/infrastructure/database/migrations.js';
import type { LeaderTerm } from '../src/infrastructure/jobs/leadership.js';
import { interestStore } from '../src/modules/data-platform/interests.js';
import type { SourceReader } from '../src/modules/data-platform/reader.js';
import { adsbFiSource } from '../src/modules/data-platform/sources/air/adsb-fi.js';
import { adsbLolSource } from '../src/modules/data-platform/sources/air/adsb-lol.js';
import { faaAirportStatusSource } from '../src/modules/data-platform/sources/city/faa-airport-status.js';
import { checkFlight } from '../src/modules/journeys/flight-watch.js';
import { journeyStore } from '../src/modules/journeys/journey-store.js';
import { runJourneyWatch } from '../src/modules/journeys/watch.js';
import {
  adbFlight,
  alertsSchema,
  answered,
  DEADLINE,
  departureDelay,
  finder,
  flightJourney,
  flightLive,
  NOW,
  passFlight,
  plane,
  sourced,
  sources,
} from './support/flights.js';
import { fakeRouting } from './support/journeys.js';
import { manualClock, type ManualClock } from './support/manual-clock.js';
import { memoryLogger } from './support/memory-logger.js';
import { servingSource } from './support/sources.js';
import { tempDatabase, type TempDatabase } from './support/temp-database.js';
import { waitFor } from './support/wait.js';
import { stepFreeLists, stepFreeReader } from './support/step-free.js';

const delayed = adbFlight({
  revisedDeparture: { at: '2026-11-11T15:40:00.000Z', kind: 'revised' },
});

describe('checkFlight', () => {
  it('moves the deadline when the flight is 20 min late, with the proof (F-J2-08)', async () => {
    const step = await checkFlight(
      flightJourney(adbFlight()),
      sources(finder(answered(delayed))),
      flightLive(),
      NOW,
    );
    expect(step?.arriveBy).toBe('2026-11-11T13:40:00.000Z');
    expect(step?.incidents).toMatchObject([
      {
        id: 'flight-time:2026-11-11T15:40:00.000Z',
        kind: 'flight',
        impactMinutes: 20,
        evidence:
          'AA 100 now leaves at 10:40, 20 min later than the 10:20 planned (AeroDataBox, revised): ' +
          'be at the terminal by 08:40.',
        provenance: { sourceId: 'aerodatabox' },
      },
    ]);
  });

  it('reports a gate change, and keeps reporting it while the gate stays', async () => {
    const moved = adbFlight({ gate: 'B20' });
    const first = await checkFlight(
      flightJourney(adbFlight()),
      sources(finder(answered(moved))),
      flightLive(),
      NOW,
    );
    const gate = first?.incidents.find((incident) => incident.id === 'flight-gate:B20');
    expect(gate?.evidence).toBe('AA 100 changed gate from B12 to B20 (AeroDataBox).');
    if (first === undefined || gate === undefined) throw new Error('expected a gate change');
    const later = { ...flightJourney(adbFlight(), first.check), incidents: [gate] };
    const second = await checkFlight(later, sources(finder(answered(moved))), flightLive(), NOW);
    expect(second?.incidents.map((incident) => incident.id)).toEqual(['flight-gate:B20']);
  });

  it("reports the FAA's delay at the airport, and a source that is down", async () => {
    const step = await checkFlight(
      flightJourney(adbFlight()),
      sources(finder(answered(adbFlight()))),
      flightLive({ programs: [departureDelay], lolDown: true }),
      new Date('2026-11-11T14:30:00.000Z'),
    );
    expect(step?.incidents).toMatchObject([
      {
        id: 'flight-check:faa-delay',
        kind: 'flight',
        provenance: { sourceId: 'faa-airport-status' },
      },
      { id: 'airport:JFK:delay-departure', kind: 'airport', impactMinutes: 30 },
    ]);
  });

  it('plans from the boarding pass while AeroDataBox is out of units, and says it is not checked live', async () => {
    const pass = passFlight('2026-11-11T15:20:00.000Z');
    const flights = finder({
      ok: false,
      state: 'rate_limited',
      code: 'monthly-units',
      detail: 'No units left.',
    });
    const step = await checkFlight(flightJourney(pass), sources(flights), flightLive(), NOW);
    expect(step?.arriveBy).toBe(DEADLINE);
    expect(step?.check.departure).toMatchObject({ basis: 'boarding-pass' });
    expect(step?.incidents).toMatchObject([
      {
        id: 'source-down:flight:aerodatabox',
        kind: 'source-down',
        evidence: expect.stringContaining(
          'AA 100 is not checked live with AeroDataBox: No units left.',
        ) as unknown,
      },
    ]);
  });

  it('says the aircraft is taxiing, and leaves the deadline alone once it moves', async () => {
    const step = await checkFlight(
      flightJourney(adbFlight()),
      sources(finder(answered(delayed))),
      flightLive({ aircraft: [plane({ groundSpeedKnots: 14 })] }),
      new Date('2026-11-11T15:00:30.000Z'),
    );
    expect(step?.arriveBy).toBe(DEADLINE);
    expect(
      step?.incidents.find((incident) => incident.id === 'flight-moving:taxiing')?.evidence,
    ).toBe('AA 100 is taxiing: AAL100 is on the ground at 14 kt, 0.4 NM from JFK.');
  });

  it('says where the plane for the flight is while it is still on its way in (F-J2-08)', async () => {
    const fromLaGuardia = adbFlight({ airport: 'LGA' });
    // 24.3 NM north of LaGuardia: about 28 miles.
    const coming = plane({
      callsign: 'AAL2213',
      onGround: false,
      altitudeFeet: 9000,
      latitude: 41.1824,
      longitude: -73.874,
      observedAt: '2026-11-11T12:29:50.000Z',
    });
    const step = await checkFlight(
      flightJourney(fromLaGuardia),
      sources(finder(answered(fromLaGuardia))),
      flightLive({ aircraft: [coming] }),
      NOW,
    );
    expect(step?.incidents).toMatchObject([
      {
        id: 'flight-inbound',
        kind: 'flight',
        evidence: 'Your plane is in the air, about 28 miles from LaGuardia.',
        provenance: { sourceId: 'adsb-lol-new-york', ageSeconds: 10 },
      },
    ]);
    expect(step?.check.movement).toBeNull();
    expect(step?.arriveBy).toBe(DEADLINE);
  });

  it('does not ask AeroDataBox again once the flight has taken off', async () => {
    const left = adbFlight({ takeOffAt: '2026-11-11T15:31:00.000Z', status: 'Departed' });
    const flights = finder(answered(left));
    const first = await checkFlight(
      flightJourney(adbFlight()),
      sources(flights),
      flightLive(),
      NOW,
    );
    expect(first?.check.departure?.basis).toBe('take-off');
    if (first === undefined) throw new Error('expected a check');
    await checkFlight(flightJourney(adbFlight(), first.check), sources(flights), flightLive(), NOW);
    expect(flights.asked()).toBe(1);
  });
});

describe('the watch with a flight', () => {
  let temp: TempDatabase;
  let db: Database;
  let clock: ManualClock;

  beforeEach(async () => {
    temp = await tempDatabase();
    db = await temp.open();
    clock = manualClock(NOW.toISOString());
    await migrate(
      db,
      await readMigrations(fileURLToPath(new URL('../migrations/', import.meta.url))),
      clock,
    );
  });

  afterEach(async () => {
    await temp.dispose();
  });

  it('recalculates the deadline from the delayed flight and watches the trip against it', async () => {
    const journey = flightJourney(adbFlight());
    await journeyStore.create(db, journey, 'traveller-1', clock.now());
    const live = flightLive();
    const reader: SourceReader = stepFreeReader(stepFreeLists(), {
      read: (definition) => {
        const reading =
          definition.id === faaAirportStatusSource.id
            ? live.airportStatus
            : definition.id === adsbLolSource.id
              ? live.aircraft[0]
              : definition.id === adsbFiSource.id
                ? live.aircraft[1]
                : { data: { trips: [], alerts: [] }, provenance: sourced(definition.id) };
        return Promise.resolve({
          data: reading.data === undefined ? undefined : definition.dataSchema.parse(reading.data),
          provenance: reading.provenance,
        });
      },
    });
    const controller = new AbortController();
    const term: LeaderTerm = {
      name: 'worker',
      holder: 'test',
      fencingToken: 1,
      signal: controller.signal,
      fenced: (work) => db.transaction(work),
    };
    const running = runJourneyWatch(term, {
      db,
      clock,
      logger: memoryLogger().logger,
      reader,
      routing: fakeRouting([]),
      fares: { fareFor: () => null },
      predictionSources: [],
      alertsSource: servingSource('alerts', alertsSchema),
      flightSources: sources(finder(answered(delayed))),
      intervalMs: 10,
      replanEveryMs: 60_000,
    });
    await waitFor(async () => (await journeyStore.get(db, 'j1'))?.journey.watch.flight !== null);
    controller.abort();
    await running;
    const stored = (await journeyStore.get(db, 'j1'))?.journey;
    expect(stored?.request.arriveBy).toBe('2026-11-11T13:40:00.000Z');
    expect(stored?.request.flight).toEqual(journey.request.flight);
    expect(stored?.watch).toMatchObject({
      status: 'on-track',
      evidence: 'On track: arriving about 08:30, 10 min to spare.',
      flight: { departure: { basis: 'revised', at: '2026-11-11T15:40:00.000Z' } },
    });
    expect(stored?.incidents.map((incident) => incident.kind)).toEqual(['flight']);
    expect([...(await interestStore.activeSourceIds(db, clock.now()))].sort()).toEqual([
      'adsb-fi-new-york',
      'adsb-lol-new-york',
      'alerts',
      'faa-airport-status',
      'mta-elevator-equipment',
      'mta-elevator-inventory',
      'mta-elevators',
      'mta-subway-entrances',
      'mta-subway-stations',
    ]);
  });
});
