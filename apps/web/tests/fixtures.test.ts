import {
  auditListSchema,
  jobListSchema,
  opsSessionSchema,
  opsSummarySchema,
  sourceDetailSchema,
  sourceListSchema,
  sourceStateSchema,
} from '@moviq/contracts';
import { describe, expect, it } from 'vitest';

import { opsFixtures } from './fixtures/ops';

const fixtures = opsFixtures(Date.parse('2026-11-11T14:00:00.000Z'));

describe('control room fixtures', () => {
  it('match the API contracts', () => {
    expect(opsSessionSchema.safeParse(fixtures.admin).success).toBe(true);
    expect(opsSessionSchema.safeParse(fixtures.viewer).success).toBe(true);
    expect(opsSummarySchema.safeParse(fixtures.summary).error).toBeUndefined();
    expect(sourceListSchema.safeParse(fixtures.sources).error).toBeUndefined();
    expect(jobListSchema.safeParse(fixtures.jobs).error).toBeUndefined();
    expect(auditListSchema.safeParse(fixtures.audit).error).toBeUndefined();
    for (const detail of Object.values(fixtures.details)) {
      expect(sourceDetailSchema.safeParse(detail).error).toBeUndefined();
    }
  });

  it('cover every source state, so the review sees each one', () => {
    const states = new Set(fixtures.sources.sources.map((source) => source.state));
    expect([...states].sort()).toEqual([...sourceStateSchema.options].sort());
  });
});
