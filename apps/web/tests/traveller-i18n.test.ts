import { watchStatusSchema } from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { creditsEn, creditsEs } from '../src/features/credits/texts';
import { homeEn, homeEs } from '../src/features/home/texts';
import { planEn, planEs } from '../src/features/plan/texts';
import { tripEn, tripEs } from '../src/features/trip/texts';
import { ticketsEn, ticketsEs } from '../src/features/tickets/texts';
import { journeyEn, journeyEs } from '../src/shared/journey/texts';

function shape(value: unknown, path = ''): string[] {
  if (typeof value === 'function') return [`${path}: function/${String(value.length)}`];
  if (typeof value === 'string') return [`${path}: string`];
  if (typeof value !== 'object' || value === null) return [`${path}: ${typeof value}`];
  return Object.entries(value).flatMap(([key, child]) =>
    shape(child, path === '' ? key : `${path}.${key}`),
  );
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(strings);
}

const PAIRS = [
  ['planner', planEn, planEs],
  ['trip', tripEn, tripEs],
  ['legs and times', journeyEn, journeyEs],
  ['home page and My trips', homeEn, homeEs],
  ['credits', creditsEn, creditsEs],
  ['ticket catalogue and wallet', ticketsEn, ticketsEs],
] as const;

describe('traveller texts', () => {
  for (const [name, en, es] of PAIRS) {
    it(`have the same keys in English and Spanish (${name}) and none empty`, () => {
      expect(shape(es).sort()).toEqual(shape(en).sort());
      for (const text of [...strings(en), ...strings(es)]) expect(text.trim()).not.toBe('');
    });
  }

  it('name every watch status of the contract', () => {
    for (const dict of [tripEn, tripEs]) {
      expect(Object.keys(dict.status).sort()).toEqual([...watchStatusSchema.options].sort());
    }
    for (const dict of [homeEn, homeEs]) {
      expect(Object.keys(dict.trips.status).sort()).toEqual([...watchStatusSchema.options].sort());
    }
  });

  it('give the home page the same words for Sara as the planner, so both read as one', () => {
    for (const [home, plan] of [
      [homeEn, planEn],
      [homeEs, planEs],
    ] as const) {
      expect(home.question).toBe(plan.question);
      expect(home.composer).toBe(plan.composer);
      expect(home.send).toBe(plan.send);
    }
  });
});
