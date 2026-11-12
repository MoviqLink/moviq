import type { Job } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';

import { useT } from '../../../../shared/i18n';
import type { Dict } from '../../../../shared/i18n/en';
import { NUMERIC } from '../../../../shared/ui/DataGrid';
import { opsHref } from '../../routes';
import { Clock } from '../../ui/LiveTime';

/** What the grid needs from the screen: who may act and what to do when they do. */
export interface JobsContext {
  readonly canAct: boolean;
  readonly onCancel: (job: Job) => void;
}

type Cell = CustomCellRendererProps<Job, unknown, JobsContext>;

const LOOK: Record<Job['state'], string> = {
  pending: 'unknown',
  running: 'rate_limited',
  done: 'healthy',
  failed: 'unavailable',
  cancelled: 'outside_service',
};

/** Only a job that has not started can be cancelled; a running one finishes on its own. */
export const canCancel = (job: Job): boolean => job.state === 'pending';

function StateCell({ data }: Cell) {
  const t = useT().jobStates;
  if (data === undefined) return null;
  return <span className={`outcome st-${LOOK[data.state]}`}>{t[data.state]}</span>;
}

function TargetCell({ data }: Cell) {
  if (data === undefined) return null;
  return (
    <a className="cell-link mono" href={opsHref.source(data.target)}>
      {data.target}
    </a>
  );
}

function TimeCell({ value }: CustomCellRendererProps<Job, string | null>) {
  return value === null || value === undefined ? <>—</> : <Clock at={value} />;
}

function ActionCell({ data, context }: Cell) {
  const t = useT().ops.jobs;
  if (data === undefined || !canCancel(data)) return null;
  return (
    <button
      type="button"
      className="btn small"
      disabled={!context.canAct}
      title={context.canAct ? undefined : t.viewerOnly}
      onClick={() => {
        context.onCancel(data);
      }}
    >
      {t.cancel}
    </button>
  );
}

/** On narrow screens nothing is pinned, so every column keeps room to be read. */
export function jobColumns(t: Dict, narrow: boolean): ColDef<Job>[] {
  const c = t.ops.jobs;
  return [
    { colId: 'id', headerName: c.colId, field: 'id', width: 80, ...NUMERIC },
    { colId: 'state', headerName: c.colState, field: 'state', cellRenderer: StateCell, width: 120 },
    {
      colId: 'target',
      headerName: c.colTarget,
      field: 'target',
      cellRenderer: TargetCell,
      width: 180,
    },
    { colId: 'by', headerName: c.colBy, field: 'requestedBy', width: 120, cellClass: 'mono' },
    { colId: 'reason', headerName: c.colReason, field: 'reason', flex: 2, minWidth: 180 },
    {
      colId: 'created',
      headerName: c.colCreated,
      field: 'createdAt',
      cellRenderer: TimeCell,
      width: 110,
    },
    {
      colId: 'finished',
      headerName: c.colFinished,
      field: 'finishedAt',
      cellRenderer: TimeCell,
      width: 110,
    },
    { colId: 'attempts', headerName: c.colAttempts, field: 'attempts', width: 90, ...NUMERIC },
    {
      colId: 'error',
      headerName: c.colError,
      field: 'lastError',
      valueFormatter: ({ data }) => data?.lastError ?? '—',
      flex: 1,
      minWidth: 150,
    },
    {
      colId: 'action',
      headerName: c.colAction,
      cellRenderer: ActionCell,
      width: 110,
      sortable: false,
      pinned: narrow ? null : 'right',
    },
  ];
}
