import { codeBuffer, readTrip, writeTrip, type CodeBuffer } from './stop-times-codec.js';

/** Sequences are kept in blocks of this many, so the column grows without copying. */
const BLOCK = 1 << 16;

function sequenceColumn(): { set(at: number, value: number): void; get(at: number): number } {
  const blocks: Int32Array[] = [];
  return {
    set(at, value) {
      const block = blocks[at >>> 16] ?? new Int32Array(BLOCK);
      blocks[at >>> 16] = block;
      block[at & (BLOCK - 1)] = value;
    },
    get: (at) => blocks[at >>> 16]?.[at & (BLOCK - 1)] ?? 0,
  };
}

/** The calls of one run: rows of one trip that follow each other in the file. */
interface Run {
  stop: number[];
  sequence: number[];
  arrival: number[];
  departure: number[];
  flags: number[];
}

/** Where each run went: its trip, its encoded characters and its sequences. */
interface Placed {
  readonly trip: number[];
  readonly from: number[];
  readonly to: number[];
  readonly firstSequence: number[];
}

type Outcome =
  { readonly ok: true; readonly calls: string } | { readonly ok: false; readonly detail: string };

function emptyRun(): Run {
  return { stop: [], sequence: [], arrival: [], departure: [], flags: [] };
}

/** The positions of a run's calls in `stop_sequence` order, or the sequence it repeats. */
function order(sequence: readonly number[]): number[] | number {
  const positions = sequence.map((_, at) => at);
  positions.sort((a, b) => (sequence[a] ?? 0) - (sequence[b] ?? 0));
  for (let at = 1; at < positions.length; at += 1) {
    const value = sequence[positions[at] ?? 0] ?? 0;
    if (value === sequence[positions[at - 1] ?? 0]) return value;
  }
  return positions;
}

function picked(run: Run, positions: readonly number[]): Run {
  const pick = (list: readonly number[]) => positions.map((at) => list[at] ?? 0);
  return {
    stop: pick(run.stop),
    sequence: pick(run.sequence),
    arrival: pick(run.arrival),
    departure: pick(run.departure),
    flags: pick(run.flags),
  };
}

/** A trip read in several runs, decoded and put back in one `stop_sequence` order. */
function mergeRuns(
  runs: readonly number[],
  placed: Placed,
  context: {
    readonly out: CodeBuffer;
    readonly stopCount: number;
    readonly sequences: ReturnType<typeof sequenceColumn>;
  },
): Run | number {
  const merged = emptyRun();
  for (const run of runs) {
    const codes = context.out.codes(placed.from[run] ?? 0, placed.to[run] ?? 0);
    const size = codes.length;
    const into = {
      stop: new Int32Array(size),
      arrival: new Int32Array(size),
      departure: new Int32Array(size),
      flags: new Uint8Array(size),
    };
    const count = readTrip(codes, { at: 0 }, context.stopCount, into, 0);
    const first = placed.firstSequence[run] ?? 0;
    for (let at = 0; at < count; at += 1) {
      merged.stop.push(into.stop[at] ?? 0);
      merged.arrival.push(into.arrival[at] ?? 0);
      merged.departure.push(into.departure[at] ?? 0);
      merged.flags.push(into.flags[at] ?? 0);
      merged.sequence.push(context.sequences.get(first + at));
    }
  }
  const positions = order(merged.sequence);
  return typeof positions === 'number' ? positions : picked(merged, positions);
}

export interface TripRuns {
  /** Adds a call; a call of another trip than the last starts a new run. */
  add(
    trip: number,
    stop: number,
    sequence: number,
    arrival: number,
    departure: number,
    flags: number,
  ): void;
  /** Every trip's calls in `stop_sequence` order, one after another in the order trips appear. */
  finish(tripIds: readonly string[], stopCount: number): Outcome;
}

/**
 * Stop times by runs: each run of rows of one trip is put in `stop_sequence` order and encoded as
 * soon as it ends, so only one trip is held at a time. A trip whose rows come back later in the
 * file, as GTFS allows, has its runs merged at the end.
 */
export function tripRuns(): TripRuns {
  const out = codeBuffer();
  const sequences = sequenceColumn();
  const placed: Placed = { trip: [], from: [], to: [], firstSequence: [] };
  const runsOfTrip: number[] = [];
  let run = emptyRun();
  let trip = -1;
  let stored = 0;
  let repeated: { readonly trip: number; readonly sequence: number } | undefined;

  /** Encodes the run that just ended and starts an empty one. */
  const close = (): void => {
    const ended = run;
    run = emptyRun();
    if (trip < 0 || ended.stop.length === 0) return;
    const increasing = ended.sequence.every(
      (value, at) => at === 0 || (ended.sequence[at - 1] ?? 0) < value,
    );
    const positions = increasing ? undefined : order(ended.sequence);
    if (typeof positions === 'number') {
      repeated ??= { trip, sequence: positions };
      return;
    }
    const sorted = positions === undefined ? ended : picked(ended, positions);
    placed.trip.push(trip);
    placed.from.push(out.length);
    placed.firstSequence.push(stored);
    writeTrip(out, sorted);
    placed.to.push(out.length);
    for (const value of sorted.sequence) {
      sequences.set(stored, value);
      stored += 1;
    }
    runsOfTrip[trip] = (runsOfTrip[trip] ?? 0) + 1;
  };

  return {
    add(nextTrip, stop, sequence, arrival, departure, flags) {
      if (nextTrip !== trip) {
        close();
        trip = nextTrip;
      }
      run.stop.push(stop);
      run.sequence.push(sequence);
      run.arrival.push(arrival);
      run.departure.push(departure);
      run.flags.push(flags);
    },
    finish(tripIds, stopCount) {
      close();
      const repeat = (at: number, sequence: number): Outcome => ({
        ok: false,
        detail: `stop_times.txt: trip ${tripIds[at] ?? ''} repeats stop_sequence ${String(sequence)}`,
      });
      if (repeated !== undefined) return repeat(repeated.trip, repeated.sequence);
      if (runsOfTrip.every((runs) => runs === 1)) return { ok: true, calls: out.text() };
      const byTrip = tripIds.map((): number[] => []);
      placed.trip.forEach((owner, at) => byTrip[owner]?.push(at));
      const merged = codeBuffer();
      for (const [at, runs] of byTrip.entries()) {
        const calls = mergeRuns(runs, placed, { out, stopCount, sequences });
        if (typeof calls === 'number') return repeat(at, calls);
        writeTrip(merged, calls);
      }
      return { ok: true, calls: merged.text() };
    },
  };
}
