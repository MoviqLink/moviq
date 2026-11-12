import { toInstant } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import { LeaseLostError, type LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';

export interface HeartbeatOptions {
  readonly clock: Clock;
  readonly intervalMs: number;
  /** Heartbeats older than this are deleted as new ones arrive. */
  readonly retentionMs: number;
  readonly logger: Logger;
}

const INSERT = `INSERT INTO worker_heartbeats (beat_at, holder, fencing_token, latency_ms)
VALUES (?, ?, ?, ?)`;

const PRUNE = 'DELETE FROM worker_heartbeats WHERE beat_at < ?';

/**
 * The hosting probe: while this worker leads, it records a heartbeat every interval through a
 * fenced write. A worker that lost the lease cannot add a single beat. A passing failure is
 * logged and the next beat is tried: it is a gap in the probe, not a change of leader.
 */
export async function runHeartbeat(term: LeaderTerm, options: HeartbeatOptions): Promise<void> {
  while (!term.signal.aborted) {
    try {
      await beat(term, options);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      options.logger.warn('heartbeat failed', { error });
    }
    await pause(options.intervalMs, term.signal);
  }
}

async function beat(term: LeaderTerm, options: HeartbeatOptions): Promise<void> {
  const asked = performance.now();
  await term.fenced(async (tx) => {
    const now = options.clock.now();
    const latencyMs = Math.round(performance.now() - asked);
    await tx.execute({
      sql: INSERT,
      args: [toInstant(now), term.holder, term.fencingToken, latencyMs],
    });
    await tx.execute({
      sql: PRUNE,
      args: [toInstant(new Date(now.getTime() - options.retentionMs))],
    });
  });
}
