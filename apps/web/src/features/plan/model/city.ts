import type { CitySource } from '@moviq/contracts';

import { formatCityTime } from '../../../shared/time/city';
import type { PlanDict } from '../texts';

/** One source under an answer: its title and the time of its data, or why there is none. */
export interface SourceNote {
  readonly sourceId: string;
  readonly title: string;
  /** "7:42 AM", or the state when the data cannot be relied on. */
  readonly when: string;
  /** False when the source could not be read or its copy is too old to rely on. */
  readonly usable: boolean;
}

const USABLE: ReadonlySet<CitySource['state']> = new Set(['healthy', 'degraded']);

/** The sources of an answer as the discreet line under it says them, in its order. */
export function sourceNotes(
  sources: readonly CitySource[],
  t: PlanDict['city'],
  locale: string,
): SourceNote[] {
  return sources.map((source) => {
    const usable = USABLE.has(source.state) && source.dataTime !== null;
    const when =
      usable && source.dataTime !== null
        ? t.dataOf(formatCityTime(source.dataTime, locale))
        : t.states[source.state];
    return { sourceId: source.sourceId, title: source.title, when, usable };
  });
}
