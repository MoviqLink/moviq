import { recordedEventSchema, type RecordedEvent } from '../events.js';
import { readLines, type HourFile } from '../files.js';

export interface ReadStats {
  lines: number;
  /** Lines that are not a recorded event: a torn last write, or a file edited by hand. */
  invalid: number;
  /** Versions written twice, as after a pass whose commit failed; the first copy is read. */
  repeatedRuns: number;
}

export const emptyStats = (): ReadStats => ({ lines: 0, invalid: 0, repeatedRuns: 0 });

function parse(line: string): RecordedEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = recordedEventSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export interface HourEvent {
  readonly hour: string;
  readonly event: RecordedEvent;
}

/**
 * The events of one source in one day, in the order they were written. Each version is read
 * once. `wanted` skips lines before they are parsed, for passes that need one kind only;
 * version markers are always read.
 */
export async function* sourceEvents(
  files: readonly HourFile[],
  stats: ReadStats,
  wanted: (line: string) => boolean = () => true,
): AsyncGenerator<HourEvent> {
  const runs = new Set<number>();
  let repeated = false;
  for (const file of files) {
    for await (const line of readLines(file.path)) {
      stats.lines += 1;
      const marker = line.startsWith('{"k":"version"');
      if (!marker && (repeated || !wanted(line))) continue;
      const event = parse(line);
      if (event === undefined) {
        stats.invalid += 1;
        continue;
      }
      if (event.k === 'version') {
        repeated = runs.has(event.run);
        if (repeated) stats.repeatedRuns += 1;
        runs.add(event.run);
        if (repeated) continue;
      }
      yield { hour: file.hour, event };
    }
  }
}

/** Keeps only lines of one kind of event, recognised before parsing. */
export const kind =
  (k: RecordedEvent['k']) =>
  (line: string): boolean =>
    line.includes(`"k":"${k}"`);
