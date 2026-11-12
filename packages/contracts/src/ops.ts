import { z } from 'zod';

import { moneySchema } from './money.js';
import { productFeatureSchema, sourceRunSchema, sourceStateSchema } from './sources.js';
import { instantSchema } from './time.js';

/** `admin` may act (refresh, cancel); `viewer` may only look. */
export const opsRoleSchema = z.enum(['admin', 'viewer']);

export type OpsRole = z.infer<typeof opsRoleSchema>;

/** `POST /api/ops/session`: exchanges an operations token for a session cookie. */
export const opsLoginRequestSchema = z.object({ token: z.string().min(1).max(512) });

/** `GET /api/ops/session`. */
export const opsSessionSchema = z.object({ role: opsRoleSchema, expiresAt: instantSchema });

export type OpsSession = z.infer<typeof opsSessionSchema>;

const nextRunReasonSchema = z.enum([
  'interval',
  'interest',
  'backoff',
  'breaker',
  'retry-after',
  'manual',
  'never',
]);

/** One row of the sources grid: everything needed to judge a source at a glance. */
export const sourceRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  provider: z.string().min(1),
  kind: z.enum(['static', 'realtime']),
  rhythm: z.enum(['cold', 'warm', 'hot']),
  state: sourceStateSchema,
  stateSince: instantSchema.nullable(),
  /** The rule and the facts behind the state, in one plain sentence. */
  evidence: z.string().min(1),
  dataTime: instantSchema.nullable(),
  ageSeconds: z.number().nonnegative().nullable(),
  freshness: z.object({
    degradedAfterSeconds: z.number().positive(),
    staleAfterSeconds: z.number().positive(),
    unavailableAfterSeconds: z.number().positive(),
  }),
  coverage: z.string().nullable(),
  lastSuccessAt: instantSchema.nullable(),
  lastAttemptAt: instantSchema.nullable(),
  lastError: z
    .object({ at: instantSchema, code: z.string().min(1), detail: z.string() })
    .nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  intervalSeconds: z.number().positive(),
  nextRunAt: instantSchema.nullable(),
  nextRunReason: nextRunReasonSchema,
  /** True while a journey, a virtual ride or an open screen needs this source fast. */
  interested: z.boolean(),
  servedVersion: z.string().nullable(),
  consumers: z.array(productFeatureSchema),
});

export type SourceRow = z.infer<typeof sourceRowSchema>;

/** `GET /api/ops/sources`. */
export const sourceListSchema = z.object({
  generatedAt: instantSchema,
  sources: z.array(sourceRowSchema),
});

const sourceIncidentSchema = z.object({
  at: instantSchema,
  fromState: sourceStateSchema,
  toState: sourceStateSchema,
  evidence: z.string().min(1),
});

/** `GET /api/ops/sources/:id`: the row plus licence, known failures, history and incidents. */
export const sourceDetailSchema = sourceRowSchema.extend({
  licence: z.object({ name: z.string(), url: z.string(), attribution: z.string() }),
  failures: z.array(
    z.object({
      code: z.string().min(1),
      detection: z.string().min(1),
      state: sourceStateSchema,
      remedy: z.string().min(1),
    }),
  ),
  fallback: z.string().nullable(),
  runs: z.array(sourceRunSchema),
  incidents: z.array(sourceIncidentSchema),
});

export type SourceDetail = z.infer<typeof sourceDetailSchema>;

/** `POST /api/ops/sources/:id/refresh` and `POST /api/ops/jobs/:id/cancel`: why, for the log. */
export const opsActionRequestSchema = z.object({ reason: z.string().trim().min(3).max(300) });

const jobStateSchema = z.enum(['pending', 'running', 'done', 'failed', 'cancelled']);

export const jobSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['source.refresh']),
  target: z.string().min(1),
  state: jobStateSchema,
  requestedBy: z.string().min(1),
  reason: z.string().min(1),
  createdAt: instantSchema,
  startedAt: instantSchema.nullable(),
  finishedAt: instantSchema.nullable(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

export type Job = z.infer<typeof jobSchema>;

/** Which jobs `GET /api/ops/jobs?state=` lists: one state, the open ones (`active`) or `all`. */
export const jobFilterSchema = z.enum([...jobStateSchema.options, 'active', 'all']);

export type JobFilter = z.infer<typeof jobFilterSchema>;

/** `GET /api/ops/jobs`: the newest jobs that match, and how many jobs there are in each state. */
export const jobListSchema = z.object({
  jobs: z.array(jobSchema),
  totals: z.record(jobStateSchema, z.number().int().nonnegative()),
});

export type JobList = z.infer<typeof jobListSchema>;

/** `GET /api/ops/worker`: the lease and the hosting probe. */
export const workerStatusSchema = z.object({
  leader: z
    .object({
      holder: z.string().min(1),
      fencingToken: z.number().int().positive(),
      expiresAt: instantSchema,
    })
    .nullable(),
  lastBeatAt: instantSchema.nullable(),
  /** The oldest heartbeat of the last day: gaps before it cannot be seen. Null without heartbeats. */
  observedFrom: instantSchema.nullable(),
  beatsLast24h: z.number().int().nonnegative(),
  /** Periods without heartbeats longer than twice the interval: restarts or outages. */
  gapsLast24h: z.array(
    z.object({ from: instantSchema, to: instantSchema, seconds: z.number().nonnegative() }),
  ),
  leaderChangesLast24h: z.number().int().nonnegative(),
  latencyMs: z.object({ p50: z.number(), p95: z.number() }).nullable(),
});

export type WorkerStatus = z.infer<typeof workerStatusSchema>;

/** `GET /api/ops/summary`: the first screen of the control room. */
export const opsSummarySchema = z.object({
  version: z.string().min(1),
  generatedAt: instantSchema,
  sourcesByState: z.record(sourceStateSchema, z.number().int().nonnegative()),
  /** Product features and whether their sources let them work. */
  features: z.array(
    z.object({
      id: productFeatureSchema,
      state: z.enum(['available', 'degraded', 'unavailable']),
      sources: z.array(z.string().min(1)),
      evidence: z.string().min(1),
    }),
  ),
  jobs: z.object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    failedLast24h: z.number().int().nonnegative(),
  }),
  worker: workerStatusSchema,
});

export type OpsSummary = z.infer<typeof opsSummarySchema>;

const auditEntrySchema = z.object({
  id: z.number().int().positive(),
  at: instantSchema,
  actor: z.string().min(1),
  action: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().nullable(),
});

/** `GET /api/ops/audit`, newest first. */
export const auditListSchema = z.object({ entries: z.array(auditEntrySchema) });

/**
 * Money MovIQ has not settled with PayPal: a release owed for a refused purchase, a refund PayPal
 * has not confirmed, a payment whose answer never arrived, a payout batch PayPal has not resolved,
 * or refunds a merchant still owes from sales already paid out.
 */
const moneyObligationKindSchema = z.enum([
  'hold-release',
  'refund',
  'payment',
  'payout-batch',
  'merchant-balance',
]);

export type MoneyObligationKind = z.infer<typeof moneyObligationKindSchema>;

/** Why an obligation is escalated: PayPal failed too many looks in a row, or it is too old. */
const moneyEscalationSchema = z.enum(['attempts', 'age']);

const moneyObligationSchema = z.object({
  id: z.string().min(1),
  kind: moneyObligationKindSchema,
  /** The record it is followed under, such as `hold 3f…` or `batch 9a…`. */
  reference: z.string().min(1),
  /** The ledger's own status, such as `owed`, `unknown · capture` or `processing`. */
  status: z.string().min(1),
  amount: moneySchema,
  since: instantSchema,
  /** Looks reconciliation has made; null where the ledger does not count them. */
  attempts: z.number().int().nonnegative().nullable(),
  /** What PayPal last answered, without card data, email addresses or secrets. */
  lastError: z.string().nullable(),
  nextCheckAt: instantSchema.nullable(),
  /** Set once the rule in `thresholds` is met. A notice for the team: travellers see nothing. */
  escalation: moneyEscalationSchema.nullable(),
});

export type MoneyObligation = z.infer<typeof moneyObligationSchema>;

/** `GET /api/ops/money`: what is open, escalated first, then oldest first. */
export const moneyInDoubtSchema = z.object({
  generatedAt: instantSchema,
  thresholds: z.object({
    /** Failed looks in a row (attempts with an error recorded) that escalate. */
    attempts: z.number().int().positive(),
    /** Hours open that escalate, by kind. */
    hours: z.record(moneyObligationKindSchema, z.number().positive()),
  }),
  totals: z.object({
    open: z.number().int().nonnegative(),
    escalated: z.number().int().nonnegative(),
    amount: moneySchema,
  }),
  obligations: z.array(moneyObligationSchema),
});

export type MoneyInDoubt = z.infer<typeof moneyInDoubtSchema>;
