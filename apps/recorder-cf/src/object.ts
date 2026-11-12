import { DurableObject } from 'cloudflare:workers';

import { createHttpClient } from '../../server/src/infrastructure/http/client.js';
import type { Env } from './env.js';
import { createReducer, jobRequestSchema, type Reducer } from './nightly/reducer.js';
import { json } from './routes.js';
import { TICK_MS, createRecorder, type Recorder } from './recorder.js';
import { leftOutSources, recordedSources } from './sources.js';
import { recorderStatus } from './status.js';

/** Raw days kept in R2 unless `RETENTION_DAYS` says otherwise. */
const DEFAULT_RETENTION_DAYS = 14;
/** The pause between two steps of the nightly reduction. */
const STEP_PAUSE_MS = 200;

const retentionDays = (env: Env): number => {
  const value = Number(env.RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS;
};

/** The recording Durable Object: one instance, woken by its own alarm. */
export class RecorderObject extends DurableObject<Env> {
  private recorder: Recorder | undefined;

  private core(): Recorder {
    this.recorder ??= createRecorder({
      sql: this.ctx.storage.sql,
      bucket: this.env.RAW,
      http: createHttpClient(),
      sources: recordedSources,
      now: Date.now,
      random: Math.random,
    });
    return this.recorder;
  }

  async alarm(): Promise<void> {
    if (this.env.STOPPED === '1') return;
    const recorder = this.core();
    let next: number;
    try {
      next = await recorder.alarm();
    } catch (error) {
      // A failed alarm is noted and the next one comes as usual: nothing in memory is dropped.
      recorder.failed(error, Date.now());
      next = Date.now() + TICK_MS;
    }
    const due = recorder.nightlyDue(Date.now());
    if (due !== undefined) {
      // The reduction reads trips (subway, buses) and incidents; positions and counts it only judges.
      const read = recordedSources.filter(
        (source) => source.extractor.mode !== null || !source.extractor.restartsDaily,
      );
      const modes = Object.fromEntries(
        read.map((source) => [source.definition.id, source.extractor.mode]),
      );
      const covered = recordedSources.map((source) => source.definition.id);
      const body = JSON.stringify({
        ...due,
        modes,
        covered,
        retentionDays: retentionDays(this.env),
      });
      const reducer = this.env.REDUCER.get(this.env.REDUCER.idFromName('nightly'));
      const answer = await reducer.fetch(
        new Request('https://reducer/start', { method: 'POST', body }),
      );
      if (answer.ok) recorder.handed(due.day);
    }
    await this.ctx.storage.setAlarm(next);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/ensure') {
      if (this.env.STOPPED !== '1' && (await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now());
      return json({ ok: true });
    }
    if (path === '/status') {
      const recorder = this.core();
      return json(recorderStatus(recorder, recordedSources, leftOutSources, Date.now()));
    }
    return json({ error: 'not-found' }, 404);
  }
}

/** The nightly reduction, a Durable Object of its own, one step per alarm. */
export class ReducerObject extends DurableObject<Env> {
  private reducer: Reducer | undefined;

  private core(): Reducer {
    this.reducer ??= createReducer(this.ctx.storage.sql, this.env.RAW);
    return this.reducer;
  }

  async alarm(): Promise<void> {
    if (await this.core().step(new Date()))
      await this.ctx.storage.setAlarm(Date.now() + STEP_PAUSE_MS);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/ensure') {
      if (this.core().pending() && (await this.ctx.storage.getAlarm()) === null)
        await this.ctx.storage.setAlarm(Date.now());
      return json({ ok: true });
    }
    if (request.method !== 'POST' || path !== '/start') return json({ error: 'not-found' }, 404);
    let value: unknown;
    try {
      value = await request.json();
    } catch {
      value = undefined;
    }
    const parsed = jobRequestSchema.safeParse(value);
    if (!parsed.success) return json({ error: 'invalid-job' }, 400);
    this.core().start(parsed.data);
    await this.ctx.storage.setAlarm(Date.now());
    return json({ ok: true });
  }
}
