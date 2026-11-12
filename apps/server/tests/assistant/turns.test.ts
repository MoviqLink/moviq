import { apiErrorSchema, assistantTurnSchema } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { assistantDatabase, BRYANT_PARK, HARLEM_456, HARLEM_STREET, JFK } from './doubles.js';
import { device, harness as build, type HarnessOptions } from './harness.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  clock = manualClock('2026-11-11T12:00:00.000Z');
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const harness = (options: Partial<HarnessOptions> = {}) => build({ db, clock, ...options });

describe('Sara in basic mode, without a model', () => {
  it('plans "Bryant Park at 7 pm from 125th Street", asking only which 125 St', async () => {
    const { app, planner } = harness();
    const traveller = device(app);
    const first = await traveller.say('Bryant Park at 7 pm from 125th Street');
    expect(first.mode).toBe('basic');
    expect(first.reply).toContain('I am in basic mode because my AI is not connected');
    expect(first.draft).toMatchObject({
      destination: BRYANT_PARK,
      arriveBy: '2026-11-12T00:00:00.000Z',
      origin: null,
      flight: null,
    });
    expect(first.missing).toEqual(['origin']);
    expect(first.reply).toContain('Which of these is where you start?');
    expect(first.choices?.slot).toBe('origin');
    expect(first.choices?.options[0]).toBe('125 St (A C B D), Manhattan');
    expect(first.plan).toBeNull();

    const second = await traveller.say('the second one');
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.draft.origin).toEqual(HARLEM_456);
    expect(second.missing).toEqual([]);
    expect(second.plan?.planId).toBe('plan-1');
    expect(second.reply).toContain(
      'Your trip is ready: leave at 6:20 pm to arrive at 6:52 pm, with 8 minutes to spare.',
    );
    expect(planner.requests[0]?.request).toMatchObject({
      origin: HARLEM_456,
      destination: BRYANT_PARK,
      arriveBy: '2026-11-12T00:00:00.000Z',
      flight: null,
    });
  });

  it('takes a flight in Spanish: the flight sets the airport and the time', async () => {
    const { app, planner } = harness();
    const traveller = device(app);
    const first = await traveller.say('al aeropuerto JFK para el vuelo DL 405 de las 10:00', 'es');
    expect(first.draft.flight).toMatchObject({ carrier: 'DL', number: '405', airport: 'JFK' });
    expect(first.draft.destination).toEqual(JFK);
    expect(first.draft.arriveBy).toBe('2026-11-11T13:00:00.000Z');
    expect(first.missing).toEqual(['origin']);
    expect(first.reply).toContain('El vuelo DL 405 sale de JFK, terminal 4 a las 10:00.');
    expect(first.draft.flight?.provenance.sourceId).toBe('aerodatabox');
    expect(first.reply).toContain('Planifico que estés en el aeropuerto a las 8:00.');
    expect(first.reply).toContain('¿Desde dónde sales?');

    const second = await traveller.say('desde la calle 125', 'es');
    expect(second.draft.origin).toEqual(HARLEM_STREET);
    expect(second.reply).toContain('Tu viaje está listo: sal a las 7:20 para llegar a las 7:52');
    expect(planner.requests[0]?.request.flight).toMatchObject({ carrier: 'DL', number: '405' });
  });

  it("finds tomorrow's flight and asks only from which 125 St, with nothing personal", async () => {
    const { app } = harness();
    const turn = await device(app).say('Vuelo AA1234 mañana desde 125th Street', 'es');
    expect(turn.draft.flight?.departureAt).toBe('2026-11-12T15:00:00.000Z');
    expect(turn.reply).toContain('El vuelo AA 1234 sale de JFK');
    expect(turn.reply).toContain('a las 10:00 mañana');
    expect(turn.missing).toEqual(['origin']);
    expect(turn.reply).toContain('¿Desde cuál de estos sales?');
    expect(turn.choices?.options[0]).toBe('125 St (A C B D), Manhattan');
    const travellers = await db.query('SELECT id FROM travellers');
    const { id } = z.object({ id: z.string() }).parse(travellers.rows[0]);
    expect(JSON.stringify(turn)).not.toContain(id);
  });

  it('asks morning or evening for "at 7", then uses the answer', async () => {
    const traveller = device(harness().app);
    const first = await traveller.say('Bryant Park at 7');
    expect(first.missing).toEqual(['arriveBy', 'origin']);
    expect(first.reply).toContain('Is that 7:00 in the morning or 7:00 in the evening?');
    const second = await traveller.say('in the evening');
    expect(second.draft.arriveBy).toBe('2026-11-12T00:00:00.000Z');
    expect(second.missing).toEqual(['origin']);
  });

  it('asks which airport, confirms a typo and resolves only after consent', async () => {
    const traveller = device(harness().app);
    const first = await traveller.say('Hola Sara voy al aeropuerto', 'es');
    expect(first.draft.destination).toBeNull();
    expect(first.reply).toContain('¿A qué aeropuerto vas: JFK, LaGuardia o Newark?');
    expect(first.reply).not.toContain('no responde');
    const typo = await traveller.say('jfkl', 'es');
    expect(typo.draft.destination).toBeNull();
    expect(typo.reply).toContain('¿Querías decir JFK?');
    const confirmed = await traveller.say('sí', 'es');
    expect(confirmed.draft.destination).toEqual(JFK);
    expect(confirmed.reply).toContain('¿A qué hora');
  });

  it('distinguishes no geocoder match from an unavailable service', async () => {
    const turn = await device(harness().app).say('unfindable destination', 'es');
    expect(turn.draft.destination).toBeNull();
    expect(turn.reply).toContain('No encuentro');
    expect(turn.reply).not.toContain('no responde');
  });

  it('says plainly when address search is down, and fills nothing', async () => {
    const turn = await device(harness({ geocoderDown: true }).app).say('Bryant Park at 7 pm');
    expect(turn.draft.destination).toBeNull();
    expect(turn.reply).toContain('Address search is not answering right now');
  });

  it('says plainly when flight search is down, and asks for the boarding pass instead', async () => {
    const turn = await device(harness({ flightsDown: true }).app).say('AA1234 from 125 Street');
    expect(turn.draft.flight).toBeNull();
    expect(turn.reply).toContain('Flight search is not answering right now');
    expect(turn.reply).toContain('What departure time does your boarding pass show');
  });

  it('says when a flight does not exist, never makes one up, and asks for the boarding pass', async () => {
    const turn = await device(harness().app).say('UA 9 from 125 Street');
    expect(turn.draft.flight).toBeNull();
    expect(turn.reply).toContain('I could not find flight UA 9 leaving New York');
    expect(turn.reply).toContain('What departure time does your boarding pass show');
  });
});

describe('conversations', () => {
  it('belong to their traveller: another device starts its own', async () => {
    const { app } = harness();
    const owner = device(app);
    const first = await owner.say('Bryant Park at 7 pm');
    const response = await app.request('/api/assistant/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: first.conversationId, message: 'hello', lang: 'en' }),
    });
    const other = assistantTurnSchema.parse(await response.json());
    expect(other.conversationId).not.toBe(first.conversationId);
    expect(other.draft.destination).toBeNull();
  });

  it('expire after half an hour without a message', async () => {
    const traveller = device(harness().app);
    const first = await traveller.say('Bryant Park at 7 pm');
    clock.advance(31 * 60_000);
    const later = await traveller.say('from 125 Street');
    expect(later.conversationId).not.toBe(first.conversationId);
    expect(later.draft.destination).toBeNull();
  });

  it('keep only the draft, never the words of the traveller', async () => {
    await device(harness().app).say('Bryant Park at 7 pm, my email is ana@example.com');
    const stored = await db.query('SELECT state FROM assistant_conversations');
    const { state } = z.object({ state: z.string() }).parse(stored.rows[0]);
    expect(state).not.toContain('example.com');
    expect(state).not.toContain('at 7 pm');
  });

  it('refuse a request that does not fit the contract', async () => {
    const { app } = harness();
    const response = await app.request('/api/assistant/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '', lang: 'fr' }),
    });
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('bad_request');
  });
});
