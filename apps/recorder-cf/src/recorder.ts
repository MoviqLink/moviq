import { toNewYorkWallClockText } from '../../server/src/infrastructure/clock/new-york.js';
import type { RecordedEvent } from '../../server/src/modules/recorder/events.js';
import type { ExtractorSession } from '../../server/src/modules/recorder/extractor.js';
import { NIGHTLY_HOUR, shiftDay } from '../../server/src/modules/recorder/nightly/calendar.js';
import { AIR_LIMIT, GROUND_LIMIT, createFixes, type Fixes } from './audit.js';
import { createBuffer, gzipLines, type Buffer } from './buffer.js';
import { masked } from './collect.js';
import { createIntake, dayOf, hourOf, type Item } from './intake.js';
import type { RecorderDeps } from './ports.js';
import { processPart, type Session } from './process.js';
import { BUDGET_MS } from './sources.js';
import {
  FREE_ROWS_PER_DAY,
  countRows,
  dayCount,
  pruneDays,
  sourceState,
  type RecorderState,
} from './state.js';
import { loadState, saveState } from './store.js';
import { uploadStep, type UploadProgress } from './upload.js';

/**
 * When nothing is due sooner, the recorder still wakes up this often: under the 10 s after which
 * an idle Durable Object may hibernate and lose what it holds in memory (its queue, sessions and
 * the events not yet written).
 */
export const TICK_MS = 8_000;
const SAVE_STATE_EVERY_MS = 60_000;
/**
 * After the object starts, one part per alarm: the first run of each source's code compiles it,
 * which took several times its usual CPU in the guard.
 */
const WARM_UP_ALARMS = 40;

export { hourOf } from './intake.js';

/**
 * The recorder of one Durable Object: each alarm uploads the hours that ended, downloads the
 * sources that are due, and turns parts into events until its CPU budget is spent. Parts left
 * wait in memory for the next alarm, which then comes at once; if the object restarts, the audit
 * says which downloads were lost.
 */
// eslint-disable-next-line max-lines-per-function -- the closure is the object's memory between alarms
export function createRecorder(deps: RecorderDeps) {
  const state: RecorderState = loadState(deps.sql);
  const buffer: Buffer = createBuffer(deps.sql);
  const sessions = new Map<string, Session>();
  const fixes = new Map<string, Fixes>();
  const queue: Item[] = [];
  const intake = createIntake({ deps, state, buffer, queue });
  let persistedHour = '';
  let alarms = 0;
  const uploads: UploadProgress = new Map();
  let savedAt = deps.now();
  const startedAt = savedAt;
  state.starts += 1;
  if (state.savedAt !== null) {
    // What was only in memory is gone: up to 30 s of events, the parts waiting, the sessions.
    const since = new Date(state.savedAt).toISOString();
    const line = `restarted: the state is from ${since}; what was recorded in memory after it was lost`;
    buffer.add(hourOf(startedAt), undefined, undefined, [line], startedAt);
  }

  const sessionOf = (item: Item, day: string): ExtractorSession => {
    const key = `${item.source.definition.id}#${String(item.part)}`;
    const current = sessions.get(key);
    if (current !== undefined && (current.day === day || !item.source.extractor.restartsDaily))
      return current.session;
    const open = new Map(Object.entries(state.incidents[item.source.definition.id] ?? {}));
    const session = item.source.extractor.start(open);
    sessions.set(key, { day, session });
    return session;
  };

  const fixesOf = (sourceId: string): Fixes => {
    const found =
      fixes.get(sourceId) ?? createFixes(sourceId.startsWith('adsb') ? AIR_LIMIT : GROUND_LIMIT);
    fixes.set(sourceId, found);
    return found;
  };

  async function processQueued(budget: number): Promise<void> {
    let spent = 0;
    const warm = alarms > WARM_UP_ALARMS;
    while (queue.length > 0) {
      const item = queue[0];
      if (item === undefined) break;
      // The first part may go over alone, unless the alarm already split a feed.
      const alone = spent === 0 && budget === BUDGET_MS;
      if (!alone && (spent + item.cost > budget || (spent > 0 && !warm))) break;
      queue.shift();
      spent += item.cost;
      await processOne(item);
    }
  }

  async function processOne(item: Item): Promise<void> {
    const id = item.source.definition.id;
    const own = sourceState(state, id, item.source.parts);
    const partState = own.parts[item.part];
    if (partState === undefined) return;
    const nowMs = item.receivedAt.getTime();
    const day = dayOf(item.receivedAt);
    const outcome = await processPart({
      source: item.source,
      part: item.part,
      body: item.body,
      partState,
      receivedAt: item.receivedAt,
      run: own.run + 1,
      session: (dataDay) => sessionOf(item, dataDay),
      dayOf,
      fixes: fixesOf(id),
    });
    const hour = hourOf(deps.now());
    if (outcome.kind === 'unchanged') {
      dayCount(state, day, id).unchanged += 1;
      intake.coverHour(day, id, nowMs);
      return;
    }
    if (outcome.kind === 'rejected') {
      dayCount(state, day, id).rejected += 1;
      buffer.add(
        hour,
        undefined,
        undefined,
        [`${id}#${String(item.part)} rejected: ${outcome.why}`],
        nowMs,
      );
      return;
    }
    own.run += 1;
    trackIncidents(id, outcome.events);
    const bytes = await gzipLines(outcome.events.map((event) => JSON.stringify(event)));
    const count = dayCount(state, dayOf(new Date(outcome.dataTime * 1000)), id);
    count.versions += 1;
    count.events += outcome.events.length - 1;
    count.bytes += bytes.byteLength;
    intake.coverHour(dayOf(new Date(outcome.dataTime * 1000)), id, outcome.dataTime * 1000);
    buffer.add(
      hour,
      id,
      bytes,
      outcome.audit.map((line) => `${id}#${String(item.part)} ${line}`),
      deps.now(),
    );
  }

  function trackIncidents(sourceId: string, events: readonly RecordedEvent[]): void {
    const open = (state.incidents[sourceId] ??= {});
    for (const event of events) {
      if (event.k === 'open' || event.k === 'change')
        open[event.id] = { fingerprint: event.fp, since: open[event.id]?.since ?? event.t };
      else if (event.k === 'close') Reflect.deleteProperty(open, event.id);
    }
  }

  let lastFailure: { readonly at: string; readonly why: string } | null = null;

  return {
    state,
    queued: () => queue.length,
    lastFailure: () => lastFailure,
    startedAt: () => new Date(startedAt).toISOString(),
    /** Notes an alarm that failed, in the status and in the audit of its hour. */
    failed(error: unknown, nowMs: number): void {
      const why = masked(
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
      lastFailure = { at: new Date(nowMs).toISOString(), why };
      buffer.add(hourOf(nowMs), undefined, undefined, [`alarm failed: ${why}`], nowMs);
    },
    /**
     * The day to hand to the nightly reduction, once it is 04:00 in New York: the late trips of
     * the night have ended. The buffer is written first so the day's last rows reach R2.
     */
    nightlyDue(nowMs: number): { day: string; counts: RecorderState['days'][string] } | undefined {
      const text = toNewYorkWallClockText(new Date(nowMs));
      if (Number(text.slice(11, 13)) < NIGHTLY_HOUR) return undefined;
      const day = shiftDay(text.slice(0, 10), -1);
      if (state.reducedUpTo !== null && state.reducedUpTo >= day) return undefined;
      const waiting = deps.sql
        .exec('SELECT COUNT(*) AS n FROM buffer WHERE hour < ?', `${text.slice(0, 10)}/00`)
        .toArray()[0]?.['n'];
      if (waiting !== 0) return undefined;
      const counts = state.days[day];
      // A first start reduces nothing before it: those days were never meant to be recorded.
      if (state.reducedUpTo === null && counts === undefined) {
        state.reducedUpTo = day;
        return undefined;
      }
      return { day, counts: counts ?? {} };
    },
    handed(day: string): void {
      state.reducedUpTo = day;
      saveState(deps.sql, state, deps.now());
    },
    /** One alarm. Returns when the next one should come. */
    async alarm(): Promise<number> {
      const nowMs = deps.now();
      const hour = hourOf(nowMs);
      alarms += 1;
      // The alarm set after this one, then each buffer row with its deletion, each state saved.
      const wrote = (rows: number) => {
        if (!countRows(state, nowMs, rows)) return;
        const line = `rows written today (UTC): ${String(state.rows.count)} of ${String(FREE_ROWS_PER_DAY)}`;
        buffer.add(hour, undefined, undefined, [line], nowMs);
      };
      wrote(1);
      if (persistedHour !== hour) {
        if (buffer.persist(nowMs, true)) wrote(2);
        persistedHour = hour;
      }
      const step = await uploadStep(deps.sql, deps.bucket, hour, uploads);
      if (step !== undefined) {
        if (step.done) buffer.add(hour, undefined, undefined, [`uploaded ${step.hour}`], nowMs);
        return deps.now();
      }
      const splitting = queue.length === 0 ? await intake.downloadDue(nowMs) : 0;
      await processQueued(BUDGET_MS - splitting);
      if (buffer.persist(deps.now(), false)) wrote(2);
      if (deps.now() - savedAt >= SAVE_STATE_EVERY_MS) {
        pruneDays(state);
        wrote(1);
        saveState(deps.sql, state, deps.now());
        savedAt = deps.now();
      }
      if (queue.length > 0) return deps.now();
      const next = Math.min(
        ...deps.sources.map(
          (source) => sourceState(state, source.definition.id, source.parts).nextAt,
        ),
      );
      return Math.max(deps.now(), Math.min(next, nowMs + TICK_MS));
    },
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
