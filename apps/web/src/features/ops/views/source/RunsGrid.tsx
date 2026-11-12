import type { RunOutcome, SourceRun } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { useMemo } from 'react';

import { useLocale, useT } from '../../../../shared/i18n';
import type { Dict } from '../../../../shared/i18n/en';
import { formatMs } from '../../../../shared/time/duration';
import { DataGrid, NUMERIC } from '../../../../shared/ui/DataGrid';
import { SectionHead } from '../../ui/Facts';
import { Clock } from '../../ui/LiveTime';

type Cell = CustomCellRendererProps<SourceRun>;

/** Each outcome borrows the colour of the source state it leads to. */
const OUTCOME_LOOK: Record<RunOutcome, string> = {
  admitted: 'healthy',
  unchanged: 'outside_service',
  rejected: 'stale',
  failed: 'unavailable',
  rate_limited: 'rate_limited',
  misconfigured: 'misconfigured',
};

function StartedCell({ data }: Cell) {
  return data === undefined ? null : <Clock at={data.startedAt} />;
}

function TriggerCell({ data }: Cell) {
  const t = useT().ops.source;
  if (data === undefined) return null;
  if (data.trigger === 'schedule') return <>{t.schedule}</>;
  return (
    <span className="cell-stack" title={data.reason ?? undefined}>
      <span>{t.manualBy(data.requestedBy ?? '—')}</span>
      {data.reason !== null && <span className="cell-sub">{data.reason}</span>}
    </span>
  );
}

function OutcomeCell({ data }: Cell) {
  const t = useT().outcomes;
  if (data === undefined) return null;
  return <span className={`outcome st-${OUTCOME_LOOK[data.outcome]}`}>{t[data.outcome]}</span>;
}

function DurationCell({ data }: Cell) {
  const locale = useLocale();
  return data === undefined ? null : <>{formatMs(data.durationMs, locale)}</>;
}

function DetailCell({ data }: Cell) {
  if (data === undefined) return null;
  const text = [data.errorCode, data.detail].filter((part) => part !== null).join(' · ');
  return <span title={text}>{text === '' ? '—' : text}</span>;
}

function runColumns(t: Dict): ColDef<SourceRun>[] {
  const c = t.ops.source;
  const dash = (value: string | number | null | undefined) =>
    value === null || value === undefined ? '—' : String(value);
  return [
    {
      colId: 'started',
      headerName: c.colStarted,
      field: 'startedAt',
      cellRenderer: StartedCell,
      width: 130,
      sort: 'desc',
    },
    {
      colId: 'trigger',
      headerName: c.colTrigger,
      field: 'trigger',
      cellRenderer: TriggerCell,
      width: 200,
    },
    {
      colId: 'outcome',
      headerName: c.colOutcome,
      field: 'outcome',
      cellRenderer: OutcomeCell,
      width: 140,
    },
    {
      colId: 'http',
      headerName: c.colHttp,
      field: 'httpStatus',
      valueFormatter: ({ data }) => dash(data?.httpStatus),
      width: 90,
      ...NUMERIC,
    },
    {
      colId: 'bytes',
      headerName: c.colBytes,
      field: 'bytes',
      valueFormatter: ({ data }) => dash(data?.bytes),
      width: 110,
      ...NUMERIC,
    },
    {
      colId: 'duration',
      headerName: c.colDuration,
      field: 'durationMs',
      cellRenderer: DurationCell,
      width: 110,
      ...NUMERIC,
    },
    {
      colId: 'version',
      headerName: c.colVersion,
      field: 'version',
      valueFormatter: ({ data }) => dash(data?.version),
      width: 150,
      cellClass: 'mono',
    },
    {
      colId: 'coverage',
      headerName: t.ops.sources.colCoverage,
      field: 'coverage',
      valueFormatter: ({ data }) => dash(data?.coverage),
      width: 160,
    },
    {
      colId: 'detail',
      headerName: c.colDetail,
      valueGetter: ({ data }) => data?.detail ?? '',
      cellRenderer: DetailCell,
      flex: 1,
      minWidth: 220,
    },
  ];
}

/** The history of collection attempts for one source, newest first. */
export function RunsGrid({ runs }: { runs: SourceRun[] }) {
  const t = useT();
  const columns = useMemo(() => runColumns(t), [t]);
  return (
    <section className="panel flush" aria-labelledby="runs-title">
      <SectionHead id="runs-title" title={t.ops.source.runs} />
      <DataGrid
        rows={runs}
        columns={columns}
        label={t.ops.source.runsGrid}
        empty={t.ops.source.runsEmpty}
        getRowId={({ data }) => String(data.id)}
      />
    </section>
  );
}
