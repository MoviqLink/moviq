import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import {
  CITY_NOW,
  fakeCity,
  liveSource,
  modeSummary,
  subwayTrain,
  type Served,
} from './city-doubles.js';
import { aceFeedData, mtaAlertsData } from './city-data.js';
import { assistantDatabase, calls, scriptedModel, text } from './doubles.js';
import { device, harness as build, type HarnessOptions } from './harness.js';

let temp: TempDatabase;
let db: Database;
let clock: ManualClock;

beforeEach(async () => {
  clock = manualClock(CITY_NOW);
  ({ temp, db } = await assistantDatabase(clock));
});

afterEach(async () => {
  await temp.dispose();
});

const harness = (options: Partial<HarnessOptions> = {}) => build({ db, clock, ...options });

const SERVED: Readonly<Record<string, Served>> = {
  'mta-alerts': { data: mtaAlertsData() },
  'mta-subway-ace': { data: aceFeedData() },
};
const CITY = fakeCity({
  modes: [modeSummary('subway', 'live', ['mta-subway-ace'])],
  vehicles: [subwayTrain()],
  sources: [liveSource('mta-subway-ace', 'MTA subway live: A C E and Rockaway shuttle')],
});

const outputSchema = z.object({ result: z.record(z.string(), z.unknown()) });

describe('Sara with a model answers about the city through the tools', () => {
  it('keeps words whose every figure a tool gave, and shows the card with its sources', async () => {
    const words = 'The A has 1 alert in force: A and C trains are running with delays.';
    const model = scriptedModel([calls(['line_status', { route: 'the A' }]), text(words)]);
    const { app } = harness({ model, served: SERVED, city: CITY });
    const turn = await device(app).say('How is the A?');
    expect(turn.mode).toBe('ai');
    expect(turn.reply).toBe(words);
    expect(turn.city[0]).toMatchObject({ kind: 'line-status', subject: 'A', level: 'notice' });
    const output = outputSchema.parse(JSON.parse(model.results[1]?.[0]?.output ?? '{}'));
    expect(output.result).toMatchObject({
      kind: 'line-status',
      alerts: { alerts: [{ since: '2026-11-11T06:00' }], aged: false },
      live: { followed: 1, cancelled: 1 },
    });
    expect(JSON.stringify(output)).not.toMatch(/40\.\d{4}/);
  });

  it('replaces words with a figure no tool gave by the fixed reply', async () => {
    const model = scriptedModel([
      calls(['line_status', { route: 'A' }]),
      text('The A has 238 alerts and trains are 25 minutes late.'),
    ]);
    const { app, log } = harness({ model, served: SERVED, city: CITY });
    const turn = await device(app).say('How is the A?');
    expect(turn.reply).toContain('There is 1 alert in force on the A.');
    expect(turn.reply).not.toContain('238');
    expect(log.text()).toContain('unknown number');
  });

  it('a line the tools do not know is said so, and nothing is made up for it', async () => {
    const model = scriptedModel([
      calls(['line_status', { route: 'Z9' }]),
      text('I do not know it.'),
    ]);
    const { app } = harness({ model, served: SERVED, city: CITY });
    const turn = await device(app).say('How is the Z9?');
    expect(model.results[1]?.[0]?.output).toContain('No line called');
    expect(turn.city).toEqual([]);
  });

  it('a scope without its field is rejected back to the model', async () => {
    const model = scriptedModel([
      calls(['incidents', { scope: 'station', route: null, station: null, mode: null }]),
      text('Which station do you mean?'),
    ]);
    const { app } = harness({ model, served: SERVED });
    const turn = await device(app).say('Any incidents at my station?');
    expect(model.results[1]?.[0]?.output).toContain('Scope station needs its station field.');
    expect(turn.reply).toBe('Which station do you mean?');
  });

  it('tells the model the alerts could not be read, and the reply says so', async () => {
    const model = scriptedModel([
      calls(['incidents', { scope: 'mode', route: null, station: null, mode: 'subway' }]),
      text("I can't check the subway alerts right now."),
    ]);
    const { app } = harness({ model });
    const turn = await device(app).say('Any subway incidents?');
    const output = outputSchema.parse(JSON.parse(model.results[1]?.[0]?.output ?? '{}'));
    expect(output.result).toMatchObject({ alerts: { alerts: null } });
    expect(turn.city[0]).toMatchObject({ level: 'unknown' });
  });
});

describe('Sara answers about the trip being planned', () => {
  it('incidents on the trip and where its train is, then the trip is still there', async () => {
    const train = subwayTrain({
      id: 'subway:B-1',
      line: { id: 'B', name: 'B', longName: null },
      destination: { name: 'Brighton Beach', basis: 'last-stop' },
    });
    const city = fakeCity({
      modes: [modeSummary('subway', 'live', ['mta-subway-bdfm'])],
      vehicles: [train],
      sources: [liveSource('mta-subway-bdfm', 'MTA subway live: B D F M and Franklin shuttle')],
    });
    const { app } = harness({ served: SERVED, city });
    const traveller = device(app);
    const planned = await traveller.say('Bryant Park at 7 pm from 125 Street');
    expect(planned.plan).not.toBeNull();
    const incidents = await traveller.say('¿Hay incidencias en mi viaje?', 'es');
    expect(incidents.reply).toContain('No hay incidencias en vigor en tu viaje (B).');
    const where = await traveller.say('Where is my train?');
    expect(where.reply).toContain('B to Brighton Beach: arriving at 59 St-Columbus Circle');
    expect(where.plan?.planId).toBe(planned.plan?.planId);
  });
});
