import type {
  Job,
  JobList,
  OpsSession,
  OpsSummary,
  SourceDetail,
  SourceRow,
  SourceRun,
  SourceState,
  auditListSchema,
} from '@moviq/contracts';

import { SPECS, type Spec } from './sources';

// Test doubles for the control room API: shaped by the contracts, never used by the product.

const at = (now: number, secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

function row(spec: Spec, now: number): SourceRow {
  const [degraded, stale, unavailable] = spec.limits;
  const attempted = spec.state === 'unknown' ? null : at(now, spec.error?.ago ?? 20);
  return {
    id: spec.id,
    title: spec.title,
    provider: spec.provider,
    kind: spec.kind,
    rhythm: spec.rhythm,
    state: spec.state,
    stateSince: spec.state === 'unknown' ? null : at(now, Math.min(spec.age ?? 3_600, 3_600)),
    evidence: spec.evidence,
    dataTime: spec.age === null ? null : at(now, spec.age),
    ageSeconds: spec.age,
    freshness: {
      degradedAfterSeconds: degraded,
      staleAfterSeconds: stale,
      unavailableAfterSeconds: unavailable,
    },
    coverage: spec.coverage,
    lastSuccessAt: spec.age === null ? null : at(now, spec.age),
    lastAttemptAt: attempted,
    lastError:
      spec.error === null
        ? null
        : { at: at(now, spec.error.ago), code: spec.error.code, detail: spec.error.detail },
    latencyMs: spec.latency,
    consecutiveFailures: spec.failures,
    intervalSeconds: spec.interval,
    nextRunAt: spec.next === null ? null : at(now, -spec.next),
    nextRunReason: spec.reason,
    interested: spec.interested,
    servedVersion:
      spec.age === null ? null : `v${String(Math.round((now / 1000 - spec.age) / 60))}`,
    consumers: [...spec.consumers],
  };
}

function runs(source: SourceRow, now: number): SourceRun[] {
  const outcomes: SourceRun['outcome'][] =
    source.consecutiveFailures > 0
      ? ['failed', 'failed', 'admitted', 'unchanged', 'admitted', 'rejected', 'admitted']
      : ['admitted', 'unchanged', 'admitted', 'admitted', 'unchanged', 'admitted', 'admitted'];
  return outcomes.map((outcome, index) => {
    const started = (index + 1) * source.intervalSeconds + 4;
    const ok = outcome === 'admitted' || outcome === 'unchanged';
    const manual = index === 2;
    return {
      id: 9_000 - index,
      sourceId: source.id,
      trigger: manual ? 'manual' : 'schedule',
      requestedBy: manual ? 'admin' : null,
      reason: manual ? 'Checking the feed after the provider notice' : null,
      startedAt: at(now, started),
      finishedAt: at(now, started - 1),
      outcome,
      httpStatus: ok ? 200 : outcome === 'rejected' ? 200 : 503,
      bytes: ok ? 184_320 - index * 512 : null,
      durationMs: ok ? 640 + index * 35 : 10_000,
      dataTime: ok ? at(now, started + 6) : null,
      version: ok ? `v${String(Math.round((now / 1000 - started) / 60))}` : null,
      coverage: ok ? source.coverage : null,
      errorCode: ok ? null : outcome === 'rejected' ? 'coverage_low' : 'http_503',
      detail: ok
        ? null
        : outcome === 'rejected'
          ? 'Coverage 41 % below the 80 % minimum; the last admitted version stays served.'
          : 'The provider answered 503 Service Unavailable.',
    };
  });
}

function detail(source: SourceRow, now: number): SourceDetail {
  return {
    ...source,
    licence: {
      name: source.provider === 'MTA' ? 'MTA Data Feed Agreement' : `${source.provider} terms`,
      url: 'https://example.org/licence',
      attribution: `Data provided by ${source.provider}.`,
    },
    failures: [
      {
        code: 'http_503',
        detection: 'HTTP status 5xx from the provider.',
        state: 'degraded',
        remedy: 'Retry with growing waits; keep serving the last good data with its age.',
      },
      {
        code: 'contract',
        detection: 'The body fails the schema or a required field is missing.',
        state: 'misconfigured',
        remedy: 'Stop retrying, keep the last admitted version and fix the reader.',
      },
    ],
    fallback: source.id === 'mta-subway-ace' ? 'mta-gtfs-subway (timetable)' : null,
    runs: runs(source, now),
    incidents:
      source.state === 'healthy'
        ? []
        : [
            {
              at: at(now, 3_600),
              fromState: 'healthy',
              toState: 'degraded',
              evidence: 'First failed attempt after 2 h of good runs.',
            },
            ...(source.state === 'degraded'
              ? []
              : [
                  {
                    at: at(now, 1_200),
                    fromState: 'degraded' as const,
                    toState: source.state,
                    evidence: source.evidence,
                  },
                ]),
          ],
  };
}

function jobs(now: number): Job[] {
  const job = (
    id: number,
    fields: Partial<Job> & Pick<Job, 'state' | 'target' | 'reason'>,
  ): Job => ({
    id,
    kind: 'source.refresh',
    requestedBy: 'admin',
    createdAt: at(now, (50 - id) * 300),
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    lastError: null,
    ...fields,
  });
  return [
    job(44, { state: 'pending', target: 'mta-alerts', reason: 'Alerts stale after timeouts' }),
    job(43, {
      state: 'running',
      target: 'mta-subway-ace',
      reason: 'Retry after 503',
      requestedBy: 'worker',
      startedAt: at(now, 20),
      attempts: 1,
    }),
    job(42, {
      state: 'failed',
      target: 'mta-elevators',
      reason: 'Provider changed the feed',
      startedAt: at(now, 1_800),
      finishedAt: at(now, 1_500),
      attempts: 3,
      lastError: "Field 'equipment' is missing in every row.",
    }),
    job(41, {
      state: 'done',
      target: 'mta-gtfs-subway',
      reason: 'New timetable published',
      startedAt: at(now, 2_400),
      finishedAt: at(now, 2_340),
      attempts: 1,
    }),
    job(40, {
      state: 'cancelled',
      target: 'faa-nas-status',
      reason: 'Provider asked to wait',
      finishedAt: at(now, 3_000),
    }),
  ];
}

function audit(now: number): ReturnType<typeof auditListSchema.parse> {
  return {
    entries: [
      {
        id: 7,
        at: at(now, 60),
        actor: 'admin',
        action: 'source.refresh',
        target: 'mta-alerts',
        reason: 'Alerts stale after timeouts',
      },
      {
        id: 6,
        at: at(now, 1_800),
        actor: 'admin',
        action: 'source.refresh',
        target: 'mta-elevators',
        reason: 'Provider changed the feed',
      },
      {
        id: 5,
        at: at(now, 3_000),
        actor: 'admin',
        action: 'job.cancel',
        target: 'job:40',
        reason: 'Provider asked to wait',
      },
      {
        id: 4,
        at: at(now, 3_100),
        actor: 'admin',
        action: 'session.open',
        target: 'ops',
        reason: null,
      },
    ],
  };
}

function summary(sources: readonly SourceRow[], now: number): OpsSummary {
  const count = (state: SourceState) => sources.filter((source) => source.state === state).length;
  const sourcesByState: Record<SourceState, number> = {
    healthy: count('healthy'),
    degraded: count('degraded'),
    stale: count('stale'),
    unavailable: count('unavailable'),
    rate_limited: count('rate_limited'),
    misconfigured: count('misconfigured'),
    outside_service: count('outside_service'),
    unknown: count('unknown'),
  };
  return {
    version: '0.1.0+3f9c2ab',
    generatedAt: at(now, 2),
    sourcesByState,
    features: [
      {
        id: 'trip-planning',
        state: 'available',
        sources: ['mta-gtfs-subway'],
        evidence: 'The timetable is healthy (5 h old, limit 36 h).',
      },
      {
        id: 'live-map',
        state: 'available',
        sources: ['mta-bus-vehicles', 'mta-gtfs-subway'],
        evidence: 'Bus positions are live (18 s old).',
      },
      {
        id: 'trip-watch',
        state: 'degraded',
        sources: ['mta-bus-vehicles', 'mta-subway-ace', 'mta-alerts'],
        evidence: 'Subway A C E is degraded and alerts are stale (22 min); bus positions are live.',
      },
      {
        id: 'flights',
        state: 'degraded',
        sources: ['aerodatabox-flights', 'faa-nas-status'],
        evidence:
          'Flight status is misconfigured (AERODATABOX_KEY missing); airport status is rate limited.',
      },
      {
        id: 'step-free',
        state: 'unavailable',
        sources: ['mta-elevators'],
        evidence: 'Elevator status has had no usable data for 3 h.',
      },
    ],
    jobs: { pending: 1, running: 1, failedLast24h: 1 },
    worker: {
      leader: { holder: 'worker-7f3a', fencingToken: 18, expiresAt: at(now, -24) },
      lastBeatAt: at(now, 6),
      observedFrom: at(now, 86_390),
      beatsLast24h: 2_861,
      gapsLast24h: [
        { from: at(now, 30_600), to: at(now, 30_420), seconds: 180 },
        { from: at(now, 61_200), to: at(now, 61_110), seconds: 90 },
      ],
      leaderChangesLast24h: 2,
      latencyMs: { p50: 14, p95: 61 },
    },
  };
}

/** The jobs page answer: every job, with totals that match them. */
function jobList(now: number): JobList {
  const all = jobs(now);
  const totals = { pending: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const job of all) totals[job.state] += 1;
  return { jobs: all, totals };
}

/** Every answer of the control room API at `now`, consistent with each other. */
export function opsFixtures(now: number) {
  const sources = SPECS.map((spec) => row(spec, now));
  return {
    admin: { role: 'admin', expiresAt: at(now, -7_200) } satisfies OpsSession,
    viewer: { role: 'viewer', expiresAt: at(now, -7_200) } satisfies OpsSession,
    summary: summary(sources, now),
    sources: { generatedAt: at(now, 2), sources },
    details: Object.fromEntries(sources.map((source) => [source.id, detail(source, now)])),
    jobs: jobList(now),
    audit: audit(now),
  };
}
