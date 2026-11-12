import {
  jobFilterSchema,
  opsActionRequestSchema,
  type OpsSummary,
  type SourceState,
} from '@moviq/contracts';
import { Hono, type Context } from 'hono';

import { errorBody } from '../../infrastructure/http/errors.js';
import {
  featureStates,
  listSourceRows,
  sourceDetail,
  type SourceViewContext,
} from '../data-platform/view.js';
import { recorderRoutes } from '../recorder/routes.js';
import type { RecorderStatusDependencies } from '../recorder/status.js';
import { auditLog } from './audit.js';
import { JobStateError, jobStore } from './jobs.js';
import { moneyInDoubt } from './money-in-doubt.js';
import {
  requireAdmin,
  requireOpsSession,
  type OpsAuthDependencies,
  type OpsBindings,
} from './ops-auth.js';
import { workerStatus } from './worker-status.js';

export interface OpsDependencies extends OpsAuthDependencies {
  readonly sources: SourceViewContext;
  readonly recorder: RecorderStatusDependencies;
  readonly version: string;
  readonly heartbeatMs: number;
}

/** The jobs page shows the newest 100 that match; the totals cover every job. */
const JOB_LIST_LIMIT = 100;

const ALL_STATES: readonly SourceState[] = [
  'healthy',
  'degraded',
  'stale',
  'unavailable',
  'rate_limited',
  'misconfigured',
  'outside_service',
  'unknown',
];

/** The control room API. Everything needs a session; acting needs the admin role. */
export function opsRoutes(deps: OpsDependencies): Hono<OpsBindings> {
  const routes = new Hono<OpsBindings>();
  const { db, clock } = deps;
  routes.use(requireOpsSession(deps));
  routes.route('/recorder', recorderRoutes(deps.recorder));

  routes.get('/summary', async (c) => c.json(await summary(deps)));
  routes.get('/sources', async (c) => {
    const now = clock.now();
    return c.json({
      generatedAt: now.toISOString(),
      sources: await listSourceRows(db, deps.sources, now),
    });
  });
  routes.get('/sources/:id', async (c) => {
    const detail = await sourceDetail(db, deps.sources, c.req.param('id'), clock.now());
    return detail === undefined
      ? c.json(errorBody(c, 'not_found', 'There is no source with that id.'), 404)
      : c.json(detail);
  });
  routes.post('/sources/:id/refresh', requireAdmin, async (c) => {
    const id = c.req.param('id');
    if (!deps.sources.definitions.some((definition) => definition.id === id)) {
      return c.json(errorBody(c, 'not_found', 'There is no source with that id.'), 404);
    }
    const reason = await readReason(c);
    if (reason === undefined)
      return c.json(errorBody(c, 'bad_request', 'Say why, in 3 to 300 characters.'), 400);
    const actor = c.var.opsActor.actor;
    const job = await db.transaction(async (tx) => {
      const now = clock.now();
      const created = await jobStore.create(
        tx,
        { kind: 'source.refresh', target: id, requestedBy: actor, reason },
        now,
      );
      await auditLog.record(tx, { actor, action: 'source.refresh', target: id, reason }, now);
      return created;
    });
    return c.json(job, 202);
  });
  routes.get('/jobs', (c) => listJobs(c, db));
  routes.post('/jobs/:id/cancel', requireAdmin, async (c) => {
    const id = Number(c.req.param('id'));
    const reason = await readReason(c);
    if (!Number.isInteger(id) || reason === undefined) {
      return c.json(
        errorBody(c, 'bad_request', 'Give a job id and say why, in 3 to 300 characters.'),
        400,
      );
    }
    const actor = c.var.opsActor.actor;
    try {
      const job = await db.transaction(async (tx) => {
        const now = clock.now();
        const cancelled = await jobStore.cancel(tx, id, now);
        if (cancelled !== undefined)
          await auditLog.record(
            tx,
            { actor, action: 'job.cancel', target: String(id), reason },
            now,
          );
        return cancelled;
      });
      return job === undefined
        ? c.json(errorBody(c, 'not_found', 'There is no job with that id.'), 404)
        : c.json(job);
    } catch (error) {
      if (error instanceof JobStateError)
        return c.json(errorBody(c, 'conflict', error.message), 409);
      throw error;
    }
  });
  routes.get('/worker', async (c) => c.json(await workerStatus(db, deps.heartbeatMs, clock.now())));
  routes.get('/audit', async (c) => c.json(await auditLog.recent(db, 200)));
  routes.get('/money', async (c) => c.json(await moneyInDoubt(deps)));
  return routes;
}

/** `GET /jobs?state=`: the newest jobs that match, with the totals of every state. */
async function listJobs(c: Context<OpsBindings>, db: OpsDependencies['db']): Promise<Response> {
  const filter = jobFilterSchema.safeParse(c.req.query('state') ?? 'all');
  if (!filter.success) {
    const states = jobFilterSchema.options.join(', ');
    return c.json(errorBody(c, 'bad_request', `The state must be one of: ${states}.`), 400);
  }
  const [jobs, totals] = await Promise.all([
    jobStore.list(db, filter.data, JOB_LIST_LIMIT),
    jobStore.totals(db),
  ]);
  return c.json({ jobs, totals });
}

async function summary(deps: OpsDependencies): Promise<OpsSummary> {
  const now = deps.clock.now();
  const [rows, jobs, worker] = await Promise.all([
    listSourceRows(deps.db, deps.sources, now),
    jobStore.counts(deps.db, new Date(now.getTime() - 24 * 60 * 60_000)),
    workerStatus(deps.db, deps.heartbeatMs, now),
  ]);
  const sourcesByState = Object.fromEntries(
    ALL_STATES.map((state) => [state, rows.filter((row) => row.state === state).length]),
  ) as Record<SourceState, number>;
  return {
    version: deps.version,
    generatedAt: now.toISOString(),
    sourcesByState,
    features: featureStates(rows),
    jobs,
    worker,
  };
}

async function readReason(c: Context<OpsBindings>): Promise<string | undefined> {
  const parsed = opsActionRequestSchema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? parsed.data.reason : undefined;
}
