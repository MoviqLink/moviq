import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { assistantUsageToday } from '../../src/modules/assistant/budget.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import {
  assistantDatabase,
  BRYANT_PARK,
  calls,
  HARLEM_STREET,
  scriptedModel,
  text,
} from './doubles.js';
import { device, harness as build, PLACES, type HarnessOptions } from './harness.js';

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

/** The tool calls a model makes for "Bryant Park at 7 pm from 125 Street", played back. */
const understood = calls(
  ['find_place', { slot: 'destination', query: 'Bryant Park' }],
  ['set_arrival', { local_time: '2026-11-11T19:00' }],
  ['find_place', { slot: 'origin', query: '125 Street' }],
);
const READY =
  'Your trip is ready: leave at 6:20 pm and arrive at 6:52 pm, with 8 minutes to spare.';

describe('Sara with a language model', () => {
  it('plans through the tools and keeps the words of the model', async () => {
    const model = scriptedModel([understood, text(READY)]);
    const { app, planner } = harness({ model });
    const turn = await device(app).say('Bryant Park at 7 pm from 125 Street');
    expect(turn.mode).toBe('ai');
    expect(turn.reply).toBe(READY);
    expect(turn.draft).toMatchObject({
      destination: BRYANT_PARK,
      origin: HARLEM_STREET,
      arriveBy: '2026-11-12T00:00:00.000Z',
    });
    expect(turn.missing).toEqual([]);
    expect(turn.plan?.planId).toBe('plan-1');
    expect(planner.requests).toHaveLength(1);
    const lastResult = JSON.parse(model.results[1]?.[2]?.output ?? '{}') as unknown;
    expect(lastResult).toMatchObject({ plan: { leaveAt: '2026-11-11T18:20', spareMinutes: 8 } });
  });

  it('replaces words that name a time no source gave with the fixed reply', async () => {
    const model = scriptedModel([understood, text('Leave at 6:05 pm and you will be fine.')]);
    const { app, log } = harness({ model });
    const turn = await device(app).say('Bryant Park at 7 pm from 125 Street');
    expect(turn.mode).toBe('ai');
    expect(turn.reply).toContain('Your trip is ready: leave at 6:20 pm to arrive at 6:52 pm');
    expect(log.text()).toContain('assistant reply replaced by the fixed reply');
  });

  it('rejects a tool call that does not fit its schema and applies nothing', async () => {
    const model = scriptedModel([
      calls(
        ['set_arrival', { local_time: '7pm' }],
        ['find_flight', { carrier: 'aa', number: '1' }],
      ),
      text('What time do you need to be there?'),
    ]);
    const { app, log } = harness({ model });
    const turn = await device(app).say('Bryant Park at 7 pm');
    expect(turn.draft.arriveBy).toBeNull();
    expect(turn.draft.flight).toBeNull();
    const outputs = (model.results[1] ?? []).map((result) => JSON.parse(result.output) as unknown);
    expect(outputs).toEqual([
      expect.objectContaining({ rejected: 'The arguments do not match the schema.' }),
      expect.objectContaining({ rejected: 'The arguments do not match the schema.' }),
    ]);
    expect(log.text()).toContain('assistant tool call rejected');
  });

  it('rejects a call to a tool that does not exist', async () => {
    const model = scriptedModel([calls(['book_taxi', {}]), text('Where are you going?')]);
    const turn = await device(harness({ model }).app).say('hello');
    expect(turn.mode).toBe('ai');
    expect(model.results[1]?.[0]?.output).toContain('There is no tool with that name.');
  });

  it('falls back to basic mode, saying so, when the model gives no valid answer', async () => {
    const model = scriptedModel([
      { ok: false, reason: 'rejected', detail: 'The answer does not fit.', usage: null },
    ]);
    const turn = await device(harness({ model }).app).say('Bryant Park at 7 pm from 125 Street');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toContain('my AI did not give a valid one');
    expect(turn.draft.destination).toEqual(BRYANT_PARK);
    expect(turn.plan).not.toBeNull();
  });
});

describe('the daily token budget', () => {
  it('counts what each call used, for the control room', async () => {
    const model = scriptedModel([understood, text(READY)]);
    await device(harness({ model }).app).say('Bryant Park at 7 pm from 125 Street');
    expect(await assistantUsageToday(db, clock, 100_000)).toEqual({
      day: '2026-11-11',
      tokens: 420,
      calls: 2,
      budget: 100_000,
      remaining: 99_580,
      exhausted: false,
    });
  });

  it('switches to basic mode once spent, says so, and the model comes back the next day', async () => {
    const model = scriptedModel([understood, text(READY)]);
    const { app, budget } = harness({ model, dailyTokens: 5_000 });
    const spent = await budget.reserve(4_500);
    if (spent === undefined) throw new Error('the budget should hold 4500 tokens');
    await budget.settle(spent, 4_500);

    const today = await device(app).say('Bryant Park at 7 pm from 125 Street');
    expect(today.mode).toBe('basic');
    expect(today.reply).toContain("today's AI allowance is used up");
    expect(model.results).toHaveLength(0);

    clock.advance(24 * 60 * 60_000);
    const tomorrow = await device(app).say('Bryant Park at 7 pm from 125 Street');
    expect(tomorrow.mode).toBe('ai');
    expect((await budget.today()).day).toBe('2026-11-12');
  });
});

describe('privacy towards the model', () => {
  it('sends neither personal data nor the traveller id', async () => {
    const model = scriptedModel([text('Where are you starting from?')]);
    await device(harness({ model }).app).say(
      'My name is Ana Pérez, ana@example.com, +1 212 555 0100, booking code ABC123, seat 14C. Bryant Park at 7 pm',
    );
    const sent = JSON.stringify(model.requests);
    for (const personal of ['Ana Pérez', 'ana@example.com', '555 0100', 'ABC123', '14C']) {
      expect(sent).not.toContain(personal);
    }
    const travellers = await db.query('SELECT id FROM travellers');
    expect(sent).not.toContain(z.object({ id: z.string() }).parse(travellers.rows[0]).id);
    expect(sent).not.toMatch(/40\.\d+|-73\.\d+/);
  });

  it('blocks a tool result with personal data before it leaves, and logs it', async () => {
    const leaky = { ...BRYANT_PARK, label: 'Bryant Park, ask ana@example.com' };
    const model = scriptedModel([
      calls(['find_place', { slot: 'destination', query: 'Bryant Park' }]),
      text('Never sent.'),
    ]);
    const { app, log } = harness({ model, places: { ...PLACES, 'Bryant Park': [leaky] } });
    const turn = await device(app).say('Bryant Park');
    expect(turn.mode).toBe('basic');
    expect(turn.reply).toContain('so that nothing personal is sent to my AI');
    expect(model.results).toHaveLength(1);
    expect(log.text()).toContain('assistant message blocked before leaving');
    expect(log.text()).not.toContain('ana@example.com');
  });
});
