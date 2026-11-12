import { z } from 'zod';

import { instantSchema } from './time.js';

/** `GET /healthz`: the process is running. It says nothing about the database. */
export const livenessSchema = z.object({ status: z.literal('ok') });

export type Liveness = z.infer<typeof livenessSchema>;

const databaseCheckSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  detail: z.string().min(1),
});

const migrationsCheckSchema = z.object({
  ok: z.boolean(),
  applied: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  detail: z.string().min(1),
});

/** `GET /readyz`: the process can serve traffic, proven by a real database round trip. */
export const readinessSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  version: z.string().min(1),
  checkedAt: instantSchema,
  checks: z.object({
    database: databaseCheckSchema,
    migrations: migrationsCheckSchema,
  }),
});

export type Readiness = z.infer<typeof readinessSchema>;
