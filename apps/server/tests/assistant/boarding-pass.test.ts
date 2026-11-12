import type { Place } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import {
  assistantDatabase,
  BRYANT_PARK,
  calls,
  HARLEM_STREET,
  JFK,
  scriptedModel,
  text,
} from './doubles.js';
import { device, harness as build, PLACES, type HarnessOptions } from './harness.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  // 07:00 in New York.
  clock = manualClock('2026-11-11T12:00:00.000Z');
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const LGA: Place = {
  label: 'LaGuardia Airport, Queens',
  lat: 40.7769,
  lon: -73.874,
  kind: 'airport',
  stopId: null,
};
const places = { ...PLACES, 'LaGuardia Airport': [LGA] };
const harness = (options: Partial<HarnessOptions> = {}) => build({ db, clock, places, ...options });

describe('Sara asks for the boarding pass when AeroDataBox cannot give the flight', () => {
  it('in basic mode, once the month is spent, and plans from the time on the pass', async () => {
    const { app, planner } = harness({ flightsDown: 'no-units' });
    const traveller = device(app);
    const first = await traveller.say('AA1234 from 125 Street');
    expect(first.reply).toContain(
      "Flight lookups are paused until this month's free allowance renews, so I could not look up AA 1234.",
    );
    expect(first.reply).toContain(
      'What departure time does your boarding pass show, and from which airport: JFK, LaGuardia ' +
        'or Newark? Tell me the terminal too if you know it.',
    );
    expect(first.draft.flight).toBeNull();

    const second = await traveller.say('It leaves at 6:05 pm from JFK, terminal 8');
    expect(second.draft.flight).toMatchObject({
      carrier: 'AA',
      number: '1234',
      departureAt: '2026-11-11T23:05:00.000Z',
      airport: 'JFK',
      terminal: '8',
      gate: null,
      status: null,
      provenance: { sourceId: 'boarding-pass', dataTime: null },
    });
    expect(second.draft).toMatchObject({
      destination: JFK,
      origin: HARLEM_STREET,
      arriveBy: '2026-11-11T21:05:00.000Z',
    });
    expect(second.reply).toContain(
      'I plan from the 6:05 pm departure on your boarding pass, from JFK, terminal 8: be at the ' +
        'airport by 4:05 pm.',
    );
    expect(planner.requests[0]?.request.flight?.provenance.sourceId).toBe('boarding-pass');
  });

  it('in basic mode in Spanish, asking morning or evening and then the airport', async () => {
    const traveller = device(harness({ flightsDown: true }).app);
    const first = await traveller.say('Vuelo AA1234 desde la calle 125', 'es');
    expect(first.reply).toContain(
      'La búsqueda de vuelos no responde ahora mismo, así que no he podido buscar el AA 1234.',
    );
    expect(first.reply).toContain('¿Qué hora de salida pone tu tarjeta de embarque');
    const second = await traveller.say('a las 6', 'es');
    expect(second.reply).toContain('¿Son las 6:00 de la mañana o las 18:00 de la tarde?');
    const third = await traveller.say('de la tarde', 'es');
    expect(third.reply).toContain('¿De qué aeropuerto sale: JFK, LaGuardia o Newark?');
    const fourth = await traveller.say('LaGuardia', 'es');
    expect(fourth.draft.flight).toMatchObject({
      departureAt: '2026-11-11T23:00:00.000Z',
      airport: 'LGA',
      terminal: null,
    });
    expect(fourth.draft.destination).toEqual(LGA);
    expect(fourth.reply).toContain(
      'Planifico con la salida de las 18:00 de tu tarjeta de embarque, desde LGA: tienes que ' +
        'estar en el aeropuerto a las 16:00.',
    );
  });

  it('when AeroDataBox does not know the flight, and reads "T4" as the terminal', async () => {
    const traveller = device(harness().app);
    const first = await traveller.say('UA 9 from 125 Street');
    expect(first.reply).toContain('I could not find flight UA 9 leaving New York on 2026-11-11.');
    const second = await traveller.say('18:05, JFK T4');
    expect(second.draft.flight).toMatchObject({ airport: 'JFK', terminal: '4' });
  });

  it('with a model, through set_boarding_pass, in English and in Spanish', async () => {
    const model = scriptedModel([
      calls(['find_flight', { carrier: 'AA', number: '1234', date: null }]),
      text('I cannot look that flight up now. What departure time does your boarding pass show?'),
      calls([
        'set_boarding_pass',
        { local_time: '2026-11-11T18:05', airport: 'JFK', terminal: '8' },
      ]),
      text(
        'Perfecto: sales de JFK a las 18:05, así que tienes que estar en el aeropuerto a las 16:05.',
      ),
    ]);
    const traveller = device(harness({ model, flightsDown: 'no-units' }).app);
    const first = await traveller.say('My flight is AA1234');
    expect(first.mode).toBe('ai');
    const found = JSON.parse(model.results[1]?.[0]?.output ?? '{}') as unknown;
    expect(found).toMatchObject({
      error: "Flight lookups are paused until this month's free allowance renews.",
      next: expect.stringContaining('call set_boarding_pass') as unknown,
    });
    const second = await traveller.say('Sale a las 18:05 de JFK, terminal 8', 'es');
    expect(second.mode).toBe('ai');
    expect(second.reply).toBe(
      'Perfecto: sales de JFK a las 18:05, así que tienes que estar en el aeropuerto a las 16:05.',
    );
    expect(second.draft.flight).toMatchObject({
      departureAt: '2026-11-11T23:05:00.000Z',
      provenance: { sourceId: 'boarding-pass' },
    });
    expect(model.requests[1]?.context).toContain('Waiting for the boarding pass of AA 1234');
  });

  it('refuses a boarding pass with no flight waiting for it', async () => {
    const model = scriptedModel([
      calls([
        'set_boarding_pass',
        { local_time: '2026-11-11T18:05', airport: 'JFK', terminal: null },
      ]),
      text('Tell me your flight number first.'),
    ]);
    const turn = await device(harness({ model }).app).say('18:05 from JFK');
    expect(turn.draft.flight).toBeNull();
    const output = JSON.parse(model.results[1]?.[0]?.output ?? '{}') as unknown;
    expect(output).toMatchObject({
      error: expect.stringContaining('No flight is waiting') as unknown,
    });
  });
});

const EAST_42_MANHATTAN = { ...BRYANT_PARK, label: '89 East 42nd Street, Manhattan' };
const EAST_42_BROOKLYN = { ...BRYANT_PARK, label: '89 East 42nd Street, Brooklyn', lat: 40.65 };

describe('places Sara offered', () => {
  it('are offered when two share the name asked, never chosen for the traveller', async () => {
    const options = { ...PLACES, '89 East 42nd Street': [EAST_42_BROOKLYN, EAST_42_MANHATTAN] };
    const turn = await device(harness({ places: options }).app).say('89 East 42nd Street at 7 pm');
    expect(turn.draft.destination).toBeNull();
    expect(turn.reply).toContain('Which of these do you mean?');
    expect(turn.choices).toEqual({
      slot: 'destination',
      options: ['89 East 42nd Street, Brooklyn', '89 East 42nd Street, Manhattan'],
    });
  });

  it('stay offered when the same sentence finds the start', async () => {
    const turn = await device(harness().app).say('To 125th Street at 7 pm from Bryant Park');
    expect(turn.draft.origin).toEqual(BRYANT_PARK);
    expect(turn.draft.destination).toBeNull();
    expect(turn.reply).toContain('Which of these do you mean?');
    expect(turn.choices?.options[0]).toBe('125 St (A C B D), Manhattan');
    expect(turn.reply).not.toContain('Where are you going');
  });
});
