import { toInstant, type WorkerStatus } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

const DAY_MS = 24 * 60 * 60_000;

const leaseSchema = z.object({
  holder: z.string(),
  fencing_token: z.number().int(),
  expires_at: z.string(),
});
const beatSchema = z.object({
  beat_at: z.string(),
  fencing_token: z.number().int(),
  latency_ms: z.number().int(),
});

/**
 * The lease and the hosting probe over the last day. A gap is a stretch without heartbeats
 * longer than twice the interval, including one still open now.
 */
export async function workerStatus(
  db: Database,
  heartbeatMs: number,
  now: Date,
): Promise<WorkerStatus> {
  const [lease, beatsResult] = await Promise.all([
    db.query({
      sql: "SELECT holder, fencing_token, expires_at FROM worker_leases WHERE name = 'worker' AND expires_at > ?",
      args: [toInstant(now)],
    }),
    db.query({
      sql: 'SELECT beat_at, fencing_token, latency_ms FROM worker_heartbeats WHERE beat_at >= ? ORDER BY beat_at',
      args: [toInstant(new Date(now.getTime() - DAY_MS))],
    }),
  ]);
  const beats = beatsResult.rows.map((row) => parseRow(beatSchema, row, 'worker_heartbeats'));
  const leader =
    lease.rows.length === 0 ? null : parseRow(leaseSchema, lease.rows[0], 'worker_leases');
  const times = [...beats.map((beat) => Date.parse(beat.beat_at)), now.getTime()];
  const gaps = [];
  for (let index = 1; index < times.length; index += 1) {
    const from = times[index - 1] ?? 0;
    const to = times[index] ?? 0;
    if (to - from > 2 * heartbeatMs)
      gaps.push({
        from: toInstant(new Date(from)),
        to: toInstant(new Date(to)),
        seconds: (to - from) / 1000,
      });
  }
  const leaderChanges = beats.filter(
    (beat, index) => index > 0 && beat.fencing_token !== beats[index - 1]?.fencing_token,
  ).length;
  const latencies = beats.map((beat) => beat.latency_ms).sort((a, b) => a - b);
  return {
    leader:
      leader === null
        ? null
        : {
            holder: leader.holder,
            fencingToken: leader.fencing_token,
            expiresAt: leader.expires_at,
          },
    lastBeatAt: beats.at(-1)?.beat_at ?? null,
    observedFrom: beats[0]?.beat_at ?? null,
    beatsLast24h: beats.length,
    gapsLast24h: beats.length === 0 ? [] : gaps,
    leaderChangesLast24h: leaderChanges,
    latencyMs:
      latencies.length === 0
        ? null
        : { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}
