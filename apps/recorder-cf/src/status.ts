import type { Recorder } from './recorder.js';
import type { LeftOutSource, RecordedSource } from './sources.js';

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * The private status of the recorder: each source with its last answer, failures, last error
 * (already masked), whether a part is frozen, and the counts of today and yesterday; the sources
 * left out and why. It never holds a key: requests carry none, and errors name host and path.
 */
export function recorderStatus(
  recorder: Recorder,
  sources: readonly RecordedSource[],
  leftOut: readonly LeftOutSource[],
  nowMs: number,
) {
  const { state } = recorder;
  const days = Object.keys(state.days).sort().slice(-2);
  return {
    now: new Date(nowMs).toISOString(),
    queuedParts: recorder.queued(),
    lastAlarmFailure: recorder.lastFailure(),
    startedAt: recorder.startedAt(),
    starts: state.starts,
    rowsWrittenToday: state.rows,
    reducedUpTo: state.reducedUpTo,
    sources: sources.map((source) => {
      const own = state.sources[source.definition.id];
      return {
        sourceId: source.definition.id,
        everySeconds: source.everyMs / 1000,
        parts: source.parts,
        lastAnswerAt: iso(own?.lastAnswerAt ?? null),
        nextAt: iso(own?.nextAt ?? null),
        failures: own?.failures ?? 0,
        lastError: own?.lastError ?? null,
        frozenParts: own?.parts.flatMap((part, index) => (part.frozen ? [index] : [])) ?? [],
        days: Object.fromEntries(
          days.map((day) => [day, state.days[day]?.[source.definition.id] ?? null]),
        ),
      };
    }),
    leftOut,
  };
}
