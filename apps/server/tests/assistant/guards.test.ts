import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../src/infrastructure/database/database.js';
import { createTokenBudget } from '../../src/modules/assistant/budget.js';
import { planningToolSpecs } from '../../src/modules/assistant/planning/model-tools.js';
import { findPersonalData, scrubPersonalData } from '../../src/modules/assistant/privacy.js';
import { manualClock, type ManualClock } from '../support/manual-clock.js';
import type { TempDatabase } from '../support/temp-database.js';
import { assistantDatabase } from './doubles.js';

describe('personal data', () => {
  it.each([
    ['Write to ana.perez@example.com', 'email'],
    ['Call me at +34 612 345 678', 'phone'],
    ['Call (212) 555-0100 when you can', 'phone'],
    ['Booking code: QX7Y2B', 'booking code'],
    ['Localizador ABC123', 'booking code'],
    ['Seat 14C please', 'seat'],
    ['Passenger: Ana Pérez', 'name'],
    ['Me llamo Juan García', 'name'],
    ['Ticket 0012345678901', 'card or ticket number'],
    ['I am at 40.80400, -73.93700', 'coordinates'],
    ['id 1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'identifier'],
  ])('finds and removes it in "%s" (%s)', (text, kind) => {
    expect(findPersonalData([text])).toBe(kind);
    const scrubbed = scrubPersonalData(text);
    expect(scrubbed).toContain('[removed]');
    expect(findPersonalData([scrubbed])).toBeUndefined();
  });

  it.each([
    'Bryant Park at 7 pm from 125th Street',
    'al aeropuerto JFK para el vuelo DL 405 de las 10:00',
    'Vuelo AA1234 mañana desde la calle 125',
    'Leave at 18:20, arrive 2026-11-11T18:52',
    'The M60 to LaGuardia Terminal B',
  ])('leaves a trip sentence untouched: "%s"', (text) => {
    expect(findPersonalData([text])).toBeUndefined();
    expect(scrubPersonalData(text)).toBe(text);
  });
});

const strictObjectSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()),
  additionalProperties: z.literal(false),
});

describe('the tools offered to the model', () => {
  it('declare strict schemas: closed objects with every field required', () => {
    expect(planningToolSpecs.map((spec) => spec.name)).toEqual([
      'find_place',
      'choose_place',
      'find_flight',
      'set_boarding_pass',
      'set_arrival',
      'line_status',
      'incidents',
      'where_is',
      'station_access',
      'line_reliability',
      'restrooms_near',
      'add_stop',
      'buy_tickets',
      'watch_line',
      'find_rewards',
      'reserve_offer',
    ]);
    for (const spec of planningToolSpecs) {
      const parameters = strictObjectSchema.parse(spec.parameters);
      expect([...parameters.required].sort()).toEqual(Object.keys(parameters.properties).sort());
      expect(spec.parameters).not.toHaveProperty('$schema');
    }
  });
});

describe('the daily token budget', () => {
  let temp: TempDatabase;
  let db: Database;
  let clock: ManualClock;

  beforeEach(async () => {
    clock = manualClock('2026-11-12T04:30:00.000Z');
    ({ temp, db } = await assistantDatabase(clock));
  });

  afterEach(async () => {
    await temp.dispose();
  });

  it('never holds more than the budget, even with calls at the same time', async () => {
    const budget = createTokenBudget(db, clock, 1_000);
    const held = await Promise.all(Array.from({ length: 5 }, () => budget.reserve(300)));
    expect(held.filter((reservation) => reservation !== undefined)).toHaveLength(3);
    expect((await budget.today()).tokens).toBe(900);
  });

  it('settles a hold to what was used, or keeps it when the use is unknown', async () => {
    const budget = createTokenBudget(db, clock, 1_000);
    const first = await budget.reserve(600);
    const second = await budget.reserve(300);
    if (first === undefined || second === undefined) throw new Error('both should fit');
    await budget.settle(first, 150);
    await budget.settle(second, null);
    expect(await budget.today()).toMatchObject({ tokens: 450, calls: 2, remaining: 550 });
  });

  it('counts per New York day: 23:30 in New York is still the same day', async () => {
    const budget = createTokenBudget(db, clock, 1_000);
    expect((await budget.today()).day).toBe('2026-11-11');
    await budget.reserve(1_000);
    expect(await budget.reserve(1)).toBeUndefined();
    expect((await budget.today()).exhausted).toBe(true);
    clock.advance(60 * 60_000);
    expect((await budget.today()).day).toBe('2026-11-12');
    expect(await budget.reserve(1)).toBeDefined();
  });
});
