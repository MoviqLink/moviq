import type { SourceRow } from '@moviq/contracts';
import type { CustomCellRendererProps } from 'ag-grid-react';

import { useLocale, useT } from '../../../../shared/i18n';
import { formatDuration, formatMs } from '../../../../shared/time/duration';
import { opsHref } from '../../routes';
import { AgeMeter } from '../../ui/AgeMeter';
import { Ago, Until } from '../../ui/LiveTime';
import { StateLabel } from '../../ui/StateLabel';

type Cell = CustomCellRendererProps<SourceRow>;

export function StateCell({ data }: Cell) {
  const t = useT().ops.sources;
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <StateLabel state={data.state} />
      {data.consecutiveFailures > 0 && (
        <span className="cell-sub">{t.failures(data.consecutiveFailures)}</span>
      )}
    </span>
  );
}

export function SourceCell({ data }: Cell) {
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <a className="cell-link" href={opsHref.source(data.id)}>
        {data.title}
      </a>
      <span className="cell-sub">
        {data.provider} · <span className="mono">{data.id}</span>
      </span>
    </span>
  );
}

/** On narrow screens the state rides under the source name, so the age stays in view. */
export function SourceStateCell({ data }: Cell) {
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <a className="cell-link" href={opsHref.source(data.id)}>
        {data.title}
      </a>
      <StateLabel state={data.state} />
    </span>
  );
}

export function AgeCell({ data }: Cell) {
  if (data === undefined) return null;
  return <AgeMeter dataTime={data.dataTime} freshness={data.freshness} state={data.state} />;
}

/** The last success, with the last attempt under it when that attempt came later. */
export function SuccessCell({ data }: Cell) {
  const t = useT().ops.sources;
  if (data === undefined) return null;
  const tried = data.lastAttemptAt !== null && data.lastAttemptAt !== data.lastSuccessAt;
  return (
    <span className="cell-stack">
      <Ago at={data.lastSuccessAt} clock={false} />
      {tried && (
        <span className="cell-sub">
          {t.attempt} <Ago at={data.lastAttemptAt} clock={false} />
        </span>
      )}
    </span>
  );
}

export function ErrorCell({ data }: Cell) {
  const t = useT().time;
  if (data === undefined) return null;
  const error = data.lastError;
  if (error === null) return <span className="muted">{t.none}</span>;
  return (
    <span className="cell-stack" title={error.detail}>
      <span className="mono">{error.code}</span>
      <span className="cell-sub">
        <Ago at={error.at} clock={false} />
      </span>
    </span>
  );
}

export function LatencyCell({ data }: Cell) {
  const locale = useLocale();
  if (data === undefined) return null;
  return data.latencyMs === null ? <>—</> : <>{formatMs(data.latencyMs, locale)}</>;
}

/** The rhythm and its interval, saying when an active interest is what keeps it hot. */
export function RhythmCell({ data }: Cell) {
  const t = useT();
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <span>
        {t.rhythms[data.rhythm]}
        {data.interested && <span className="interest"> · {t.ops.sources.interestOn}</span>}
      </span>
      <span className="cell-sub mono">
        {t.ops.sources.every(formatDuration(data.intervalSeconds))}
      </span>
    </span>
  );
}

export function NextCell({ data }: Cell) {
  const t = useT();
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <Until at={data.nextRunAt} />
      <span className="cell-sub">{t.nextReasons[data.nextRunReason]}</span>
    </span>
  );
}
