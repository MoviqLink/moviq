import { unixSeconds, type ExtractedEvent, type RecordedEvent } from './events.js';
import type { HourPlace } from './files.js';
import type {
  AdmittedRun,
  DayCount,
  GapRecord,
  IncidentChange,
  RecorderBatch,
  SourcePosition,
} from './store.js';

interface OpenGap {
  readonly first: AdmittedRun;
  last: AdmittedRun;
  versions: number;
  readonly why: string;
  readonly file: string;
  readonly day: string;
}

interface MutableDay {
  readonly day: string;
  readonly sourceId: string;
  versions: number;
  events: number;
  bytes: number;
  lostVersions: number;
}

interface BatchState {
  readonly files: Map<string, string[]>;
  readonly fileDay: Map<string, MutableDay>;
  readonly days: Map<string, MutableDay>;
  readonly gaps: GapRecord[];
  readonly openGaps: Map<string, OpenGap>;
  readonly incidents: IncidentChange[];
  readonly sources: Map<string, SourcePosition>;
}

function incidentChange(
  sourceId: string,
  run: AdmittedRun,
  event: ExtractedEvent,
): IncidentChange | undefined {
  if (event.k === 'open' || event.k === 'change') {
    const { id, kind, type, routes, fp } = event;
    return { op: event.k, sourceId, id, kind, type, routes, fingerprint: fp, at: run.dataTime };
  }
  if (event.k === 'close') {
    const last = new Date(event.last * 1000);
    return { op: 'close', sourceId, id: event.id, last, at: run.dataTime };
  }
  return undefined;
}

function dayOf(state: BatchState, day: string, sourceId: string): MutableDay {
  const key = JSON.stringify([day, sourceId]);
  const found = state.days.get(key) ?? {
    day,
    sourceId,
    versions: 0,
    events: 0,
    bytes: 0,
    lostVersions: 0,
  };
  state.days.set(key, found);
  return found;
}

function push(state: BatchState, file: string, day: MutableDay, event: RecordedEvent): void {
  const lines = state.files.get(file) ?? [];
  lines.push(JSON.stringify(event));
  state.files.set(file, lines);
  state.fileDay.set(file, day);
}

/** Writes the gap a source has open, if any, as one line and one record. */
function closeGap(state: BatchState, sourceId: string): void {
  const gap = state.openGaps.get(sourceId);
  if (gap === undefined) return;
  state.openGaps.delete(sourceId);
  push(state, gap.file, dayOf(state, gap.day, sourceId), {
    k: 'gap',
    v: gap.last.version,
    t: unixSeconds(gap.last.dataTime),
    fromRun: gap.first.id,
    toRun: gap.last.id,
    versions: gap.versions,
    first: unixSeconds(gap.first.dataTime),
    why: gap.why,
  });
  state.gaps.push({
    sourceId,
    day: gap.day,
    fromRunId: gap.first.id,
    toRunId: gap.last.id,
    versions: gap.versions,
    firstDataTime: gap.first.dataTime,
    lastDataTime: gap.last.dataTime,
    evidence: `${gap.why} Runs ${String(gap.first.id)} to ${String(gap.last.id)}.`,
  });
}

function recorded(
  state: BatchState,
  run: AdmittedRun,
  place: HourPlace,
  file: string,
  events: readonly ExtractedEvent[],
): void {
  closeGap(state, run.sourceId);
  const day = dayOf(state, place.day, run.sourceId);
  const marker: RecordedEvent = {
    k: 'version',
    v: run.version,
    t: unixSeconds(run.dataTime),
    run: run.id,
    at: unixSeconds(run.admittedAt),
  };
  push(state, file, day, marker);
  for (const event of events) {
    push(state, file, day, { v: run.version, ...event });
    const change = incidentChange(run.sourceId, run, event);
    if (change !== undefined) state.incidents.push(change);
  }
  day.versions += 1;
  day.events += events.length;
  state.sources.set(run.sourceId, {
    sourceId: run.sourceId,
    lastRunId: run.id,
    lastVersion: run.version,
    lastDataTime: run.dataTime,
  });
}

function lost(state: BatchState, run: AdmittedRun, place: HourPlace, file: string, why: string) {
  const gap = state.openGaps.get(run.sourceId);
  if (gap?.why === why) {
    gap.last = run;
    gap.versions += 1;
  } else {
    closeGap(state, run.sourceId);
    state.openGaps.set(run.sourceId, {
      first: run,
      last: run,
      versions: 1,
      why,
      file,
      day: place.day,
    });
  }
  dayOf(state, place.day, run.sourceId).lostVersions += 1;
}

/**
 * Collects one pass of the recorder: the lines of each file, the counts of each day, the gaps
 * (consecutive lost versions of a source become one) and the changes to the incident registry.
 */
export function createBatch() {
  const state: BatchState = {
    files: new Map(),
    fileDay: new Map(),
    days: new Map(),
    gaps: [],
    openGaps: new Map(),
    incidents: [],
    sources: new Map(),
  };
  return {
    recorded: (
      run: AdmittedRun,
      place: HourPlace,
      file: string,
      events: readonly ExtractedEvent[],
    ) => {
      recorded(state, run, place, file, events);
    },
    lost: (run: AdmittedRun, place: HourPlace, file: string, why: string) => {
      lost(state, run, place, file, why);
    },
    /** The lines to append, file by file, once every open gap is written. */
    files(): ReadonlyMap<string, readonly string[]> {
      for (const sourceId of [...state.openGaps.keys()]) closeGap(state, sourceId);
      return state.files;
    },
    wrote(file: string, bytes: number): void {
      const day = state.fileDay.get(file);
      if (day !== undefined) day.bytes += bytes;
    },
    result(lastRunId: number): RecorderBatch {
      const days: DayCount[] = [...state.days.values()].map((count) => ({ ...count }));
      const sources = [...state.sources.values()];
      return { lastRunId, sources, days, gaps: state.gaps, incidents: state.incidents };
    },
  };
}

export type Batch = ReturnType<typeof createBatch>;
