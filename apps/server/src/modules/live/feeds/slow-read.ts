import type { SourceDefinition } from '../../data-platform/definition.js';
import type { SourceReader, SourceReading } from '../../data-platform/reader.js';

/**
 * Sources that change a few times a day at most are large, so they are read again at most once a
 * minute, as the timetables are; a state change of the source shows within that minute.
 */
const REREAD_MS = 60_000;

/** A slow source read through the platform at most once a minute, whatever the screens ask. */
export function readSlowly<T>(definition: SourceDefinition<T>) {
  let kept: { readonly at: number; readonly value: Promise<SourceReading<T>> } | undefined;
  return (reader: SourceReader, now: Date): Promise<SourceReading<T>> => {
    const at = now.getTime();
    if (kept === undefined || at - kept.at >= REREAD_MS) {
      const value = reader.read(definition);
      kept = { at, value };
      value.catch(() => {
        if (kept?.value === value) kept = undefined;
      });
    }
    return kept.value;
  };
}
