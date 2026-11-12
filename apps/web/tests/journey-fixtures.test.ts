import {
  assistantTurnSchema,
  journeySchema,
  paymentSchema,
  paymentsConfigSchema,
  planResponseSchema,
} from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import {
  applied,
  journey,
  payment,
  paymentsConfig,
  paymentsOff,
  plan,
  turns,
} from './fixtures/journeys';

const now = Date.parse('2026-11-11T12:00:00.000Z');

describe('traveller fixtures', () => {
  it('match the API contracts in both languages', () => {
    for (const lang of ['en', 'es'] as const) {
      const { asking, complete } = turns(now, lang);
      expect(assistantTurnSchema.safeParse(asking).error).toBeUndefined();
      expect(assistantTurnSchema.safeParse(complete).error).toBeUndefined();
      expect(planResponseSchema.safeParse(plan(now, lang)).error).toBeUndefined();
      expect(journeySchema.safeParse(journey(now, lang, false)).error).toBeUndefined();
      expect(journeySchema.safeParse(journey(now, lang, true)).error).toBeUndefined();
      expect(journeySchema.safeParse(journey(now, lang, true, false)).error).toBeUndefined();
      expect(journeySchema.safeParse(applied(now, lang, 'trip-risk')).error).toBeUndefined();
    }
    expect(paymentsConfigSchema.safeParse(paymentsConfig).success).toBe(true);
    expect(paymentsConfigSchema.safeParse(paymentsOff).success).toBe(true);
    expect(paymentSchema.safeParse(payment(now, 'captured')).error).toBeUndefined();
  });
});
