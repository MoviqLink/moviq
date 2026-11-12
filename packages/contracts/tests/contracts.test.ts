import { describe, expect, it } from 'vitest';

import { apiErrorSchema, instantSchema, readinessSchema, toInstant } from '../src/index.js';

describe('instants', () => {
  it('are always UTC ISO 8601 with milliseconds and a Z', () => {
    expect(toInstant(new Date(Date.UTC(2026, 10, 11, 9, 30)))).toBe('2026-11-11T09:30:00.000Z');
  });

  it('reject local times and offsets, so every stored time means the same instant', () => {
    expect(instantSchema.safeParse('2026-11-11T09:30:00.000Z').success).toBe(true);
    expect(instantSchema.safeParse('2026-11-11T09:30:00').success).toBe(false);
    expect(instantSchema.safeParse('2026-11-11T09:30:00-05:00').success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts only known codes and requires a request id', () => {
    const valid = { error: { code: 'not_found', message: 'Nothing here.', requestId: 'r-1' } };
    expect(apiErrorSchema.parse(valid)).toEqual(valid);
    expect(apiErrorSchema.safeParse({ error: { ...valid.error, code: 'teapot' } }).success).toBe(
      false,
    );
    expect(apiErrorSchema.safeParse({ error: { code: 'internal', message: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('readinessSchema', () => {
  it('describes both checks and rejects a negative latency', () => {
    const body = {
      status: 'ready',
      version: '0.1.0',
      checkedAt: '2026-11-11T09:30:00.000Z',
      checks: {
        database: { ok: true, latencyMs: 1, detail: 'The database answered.' },
        migrations: { ok: true, applied: 1, pending: 0, detail: 'All migrations are applied.' },
      },
    };
    expect(readinessSchema.parse(body)).toEqual(body);
    const negative = {
      ...body,
      checks: { ...body.checks, database: { ...body.checks.database, latencyMs: -1 } },
    };
    expect(readinessSchema.safeParse(negative).success).toBe(false);
  });
});
