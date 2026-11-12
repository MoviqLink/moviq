import { z } from 'zod';

import { shiftDay } from '../../../server/src/modules/recorder/nightly/calendar.js';
import type { RecorderMode } from '../../../server/src/modules/recorder/extractor.js';
import type { Bucket, Sql } from '../ports.js';
import { dayCountSchema } from '../state.js';
import { createNightlyJob, type NightlyJob } from './job.js';
import { createPublication } from './publish.js';

const JOB_TABLE =
  'CREATE TABLE IF NOT EXISTS job (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)';

const modeSchema = z.enum(['subway', 'bus']).nullable();

/** What the recorder hands over for one day: its counts and the mode of each source read. */
export const jobRequestSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  counts: z.record(z.string(), dayCountSchema),
  modes: z.record(z.string(), modeSchema),
  /** Every recorded source, whose hours of the day are judged. */
  covered: z.array(z.string()),
  retentionDays: z.number().int().positive(),
});

export type JobRequest = z.infer<typeof jobRequestSchema>;

/** Deletes at most this many raw keys per step: one list and one delete. */
const DELETE_PER_STEP = 1000;

/**
 * The reducer of the nightly process, a Durable Object of its own so its steps never take the
 * CPU of a recording alarm. The request waits in its SQLite: after a restart the day starts
 * over from it. Once the statistics are stored, raw days older than the retention are deleted.
 */
export function createReducer(sql: Sql, bucket: Bucket) {
  sql.exec(JOB_TABLE);
  let running:
    | {
        readonly day: string;
        readonly job: NightlyJob;
        published?: { readonly write: ReturnType<typeof createPublication>; readonly note: string };
      }
    | undefined;

  const request = (): JobRequest | undefined => {
    const text = sql.exec('SELECT json FROM job WHERE id = 1').toArray()[0]?.['json'];
    if (typeof text !== 'string') return undefined;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
    const parsed = jobRequestSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

  async function applyRetention(day: string, retentionDays: number): Promise<void> {
    const oldest = shiftDay(day, -retentionDays);
    const listed = await bucket.list({ prefix: 'raw/' });
    const old = listed.objects
      .map((object) => object.key)
      .filter((key) => key.slice(4, 14) < oldest)
      .slice(0, DELETE_PER_STEP);
    if (old.length > 0) await bucket.delete(old);
  }

  return {
    /** True while a day waits to be reduced, so the cron can set its alarm again. */
    pending: (): boolean => request() !== undefined,
    start(job: JobRequest): void {
      sql.exec('INSERT OR REPLACE INTO job (id, json) VALUES (1, ?)', JSON.stringify(job));
      running = undefined;
    },
    /** One step; true while the day is not done. */
    async step(now: Date): Promise<boolean> {
      const job = request();
      if (job === undefined) return false;
      if (running?.day !== job.day) {
        const modes = new Map<string, RecorderMode | null>(Object.entries(job.modes));
        running = {
          day: job.day,
          job: createNightlyJob(
            { day: job.day, counts: job.counts, modes, covered: job.covered },
            bucket,
          ),
        };
      }
      if (running.published === undefined) {
        const done = await running.job.step(now);
        if (done === undefined) return true;
        running.published = {
          write: createPublication(done.stats),
          note:
            `reduced ${job.day}: ${String(done.stats.counts.events)} events, ` +
            `${String(done.invalid)} invalid lines, ` +
            `${done.stats.complete ? 'complete' : 'incomplete'}\n`,
        };
        return true;
      }
      const document = running.published.write.step();
      if (document === undefined) return true;
      await bucket.put(`stats/${job.day}.json`, document);
      await bucket.put('stats/latest.json', document);
      await bucket.put(`audit/${job.day}/reduced.txt`, running.published.note);
      await applyRetention(job.day, job.retentionDays);
      sql.exec('DELETE FROM job WHERE id = 1');
      running = undefined;
      return false;
    },
  };
}

export type Reducer = ReturnType<typeof createReducer>;
