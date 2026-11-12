import type { SourceRow } from '@moviq/contracts';

import { useT } from '../../../shared/i18n';
import { useNow } from '../../../shared/time/clock';
import { formatDuration, formatLimit } from '../../../shared/time/duration';
import { agePosition, currentLimit, liveAge } from '../model/age';
import { ageLook } from '../model/states';

type Props = Pick<SourceRow, 'dataTime' | 'freshness' | 'state'> & { readonly large?: boolean };

/**
 * The real age of the data against its limit, on the route line: the dot is the data, the ticks
 * are the limits, and the line ends where the data becomes unusable. It moves only as time passes.
 */
export function AgeMeter({ dataTime, freshness, state, large = false }: Props) {
  const t = useT();
  const now = useNow();
  const age = liveAge(dataTime, now);
  if (age === null) return <span className="muted">{t.ops.sources.noData}</span>;
  const look = ageLook(state, age, freshness);
  const limit = formatLimit(currentLimit(age, freshness));
  const at = (seconds: number) => `${String(agePosition(seconds, freshness) * 100)}%`;
  return (
    <span className={`age st-${look}${large ? ' large' : ''}`}>
      <span className="age-text mono">
        <span className="age-value">{formatDuration(age)}</span>
        <span className="age-limit">/ {limit}</span>
      </span>
      <span className="age-line" aria-hidden="true">
        <span className="age-fill" style={{ width: at(age) }} />
        <span className="age-tick" style={{ left: at(freshness.degradedAfterSeconds) }} />
        <span className="age-tick" style={{ left: at(freshness.staleAfterSeconds) }} />
        <span className="age-dot" style={{ left: at(age) }} />
      </span>
    </span>
  );
}
