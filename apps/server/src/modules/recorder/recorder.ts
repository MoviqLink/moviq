import type { Clock } from '../../infrastructure/clock/clock.js';
import { pause } from '../../infrastructure/clock/pause.js';
import type { Database } from '../../infrastructure/database/database.js';
import type { LeaderTerm } from '../../infrastructure/jobs/leadership.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { SourceDefinition } from '../data-platform/definition.js';
import { snapshotStore } from '../data-platform/snapshots.js';
import { createBatch, type Batch } from './batch.js';
import type { Extractor, ExtractorSession } from './extractor.js';
import { appendLines, placeOf, recordingFile } from './files.js';
import { stopRequested } from './signals.js';
import { recorderStore, type AdmittedRun, type SourcePosition } from './store.js';

export interface RecorderDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly definitions: readonly SourceDefinition[];
  readonly extractors: readonly Extractor[];
  /** `RECORDING_DIR`. Without it the recorder does not start, and its status says so. */
  readonly directory: string | undefined;
  /** How often to look for new versions; well under the fastest source interval (30 s). */
  readonly intervalMs: number;
}

/** Runs read per pass. A pass ends with one fenced write, so the cursor never runs ahead. */
const RUNS_PER_PASS = 40;

interface Session {
  readonly day: string;
  readonly session: ExtractorSession;
}

interface PassContext {
  readonly deps: RecorderDependencies;
  readonly directory: string;
  readonly extractors: ReadonlyMap<string, Extractor>;
  readonly definitions: ReadonlyMap<string, SourceDefinition>;
  readonly sessions: Map<string, Session>;
  positions: Map<string, SourcePosition> | undefined;
}

/**
 * The recorder. It downloads nothing: it reads every version the data platform admitted, in the
 * order of `source_runs`, turns it into compact events and appends them to the files of its
 * source and hour. A version whose copy is already gone becomes a gap with its evidence.
 */
export async function runRecorder(term: LeaderTerm, deps: RecorderDependencies): Promise<void> {
  if (deps.directory === undefined) {
    deps.logger.warn('recorder not started', { reason: 'RECORDING_DIR is not set' });
    return;
  }
  const context = passContext({ ...deps, directory: deps.directory });
  while (!term.signal.aborted) {
    try {
      while (!stopRequested(term.signal) && (await recordPass(term, context))) {
        // Each pass handles a bounded number of runs; keep going while more are waiting.
      }
    } catch (error) {
      if (stopRequested(term.signal)) return;
      // What was in memory may be ahead of what was committed: start again from the database.
      context.sessions.clear();
      context.positions = undefined;
      deps.logger.error('recorder pass failed', { error });
    }
    await pause(deps.intervalMs, term.signal);
  }
}

/** One pass: read pending runs, write their events, commit the cursor. True if more wait. */
export async function recordPass(term: LeaderTerm, context: PassContext): Promise<boolean> {
  const { db, clock } = context.deps;
  const cursor = await startingCursor(term, db, clock);
  const runs = await recorderStore.admittedRuns(db, cursor, RUNS_PER_PASS);
  const last = runs.at(-1);
  if (last === undefined) return false;
  context.positions ??= await recorderStore.positions(db);
  const batch = createBatch();
  for (const run of runs) await recordRun(context, batch, run);
  for (const [file, lines] of batch.files()) {
    if (term.signal.aborted) return false;
    batch.wrote(file, await appendLines(file, lines));
  }
  const result = batch.result(last.id);
  await term.fenced((tx) => recorderStore.commit(tx, result, clock.now()));
  return runs.length === RUNS_PER_PASS;
}

/** The state the passes of one term share: sessions and the last position of each source. */
export function passContext(
  deps: RecorderDependencies & { readonly directory: string },
): PassContext {
  return {
    deps,
    directory: deps.directory,
    extractors: new Map(deps.extractors.map((extractor) => [extractor.sourceId, extractor])),
    definitions: new Map(deps.definitions.map((definition) => [definition.id, definition])),
    sessions: new Map(),
    positions: undefined,
  };
}

async function startingCursor(term: LeaderTerm, db: Database, clock: Clock): Promise<number> {
  const stored = await recorderStore.cursor(db);
  if (stored !== undefined) return stored;
  const newest = await recorderStore.newestRunId(db);
  await term.fenced((tx) => recorderStore.startCursor(tx, newest, clock.now()));
  return (await recorderStore.cursor(db)) ?? newest;
}

async function recordRun(context: PassContext, batch: Batch, run: AdmittedRun): Promise<void> {
  const extractor = context.extractors.get(run.sourceId);
  const definition = context.definitions.get(run.sourceId);
  // Sources without an extractor are not recorded; the status lists them as such.
  if (extractor === undefined || definition === undefined) return;
  const place = placeOf(run.dataTime);
  const file = recordingFile(context.directory, place, run.sourceId);
  const stored = await snapshotStore.read(context.deps.db, run.sourceId, run.version);
  if (stored === undefined) {
    const kept =
      definition.keepVersions === 1 ? '1 version' : `${String(definition.keepVersions)} versions`;
    const why = `The copy was replaced before it was read: the source keeps ${kept}.`;
    batch.lost(run, place, file, why);
    return;
  }
  const session = await sessionFor(context, extractor, place.day);
  const extraction = session.extract(stored, {
    version: run.version,
    dataTime: run.dataTime,
    previousDataTime: context.positions?.get(run.sourceId)?.lastDataTime,
  });
  if (!extraction.ok) {
    batch.lost(run, place, file, extraction.why);
    return;
  }
  batch.recorded(run, place, file, extraction.events);
  context.positions?.set(run.sourceId, {
    sourceId: run.sourceId,
    lastRunId: run.id,
    lastVersion: run.version,
    lastDataTime: run.dataTime,
  });
}

async function sessionFor(
  context: PassContext,
  extractor: Extractor,
  day: string,
): Promise<ExtractorSession> {
  const current = context.sessions.get(extractor.sourceId);
  if (current !== undefined && (current.day === day || !extractor.restartsDaily))
    return current.session;
  const open = await recorderStore.openIncidents(context.deps.db, extractor.sourceId);
  const session = extractor.start(open);
  context.sessions.set(extractor.sourceId, { day, session });
  return session;
}
