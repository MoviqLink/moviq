import type { Job, JobFilter, JobList } from '@moviq/contracts';
import type { CellKeyDownEvent, FullWidthCellKeyDownEvent } from 'ag-grid-community';
import { useMemo, useState } from 'react';

import { useT } from '../../../shared/i18n';
import { DataGrid } from '../../../shared/ui/DataGrid';
import { Icon } from '../../../shared/ui/Icon';
import { useMediaQuery } from '../../../shared/ui/useMediaQuery';
import { opsApi } from '../api';
import { useSession } from '../session';
import { ConnectionNotice } from '../ui/ConnectionNotice';
import { PageHead } from '../ui/PageHead';
import { ReasonDialog } from '../ui/ReasonDialog';
import { useResource } from '../useResource';
import { canCancel, jobColumns, type JobsContext } from './jobs/columns';

type View = 'open' | 'failed' | 'all';

const VIEWS: readonly View[] = ['open', 'failed', 'all'];

/** Each tab asks the server for its own jobs, so an old pending job never hides behind newer ones. */
const FILTER: Readonly<Record<View, JobFilter>> = { open: 'active', failed: 'failed', all: 'all' };

function countOf(view: View, totals: JobList['totals']): number {
  if (view === 'open') return totals.pending + totals.running;
  if (view === 'failed') return totals.failed;
  return Object.values(totals).reduce((sum, n) => sum + n, 0);
}

/** The queue: pending, running and failed jobs, with cancel (pending only) and its reason. */
export function JobsView() {
  const t = useT();
  const c = t.ops.jobs;
  const { session } = useSession();
  const [view, setView] = useState<View>('open');
  const list = useResource(`jobs:${view}`, (signal) => opsApi.jobs(FILTER[view], signal));
  const [cancelling, setCancelling] = useState<Job | null>(null);
  const [cancelled, setCancelled] = useState<Job | null>(null);
  const rows = useMemo(() => list.data?.jobs ?? [], [list.data]);
  const totals = list.data?.totals;
  const narrow = useMediaQuery('(max-width: 760px)');
  const columns = useMemo(() => jobColumns(t, narrow), [t, narrow]);
  const context = useMemo<JobsContext>(
    () => ({ canAct: session.role === 'admin', onCancel: setCancelling }),
    [session.role],
  );

  // Enter on the action cell does what clicking its button does.
  const onKey = (event: CellKeyDownEvent<Job> | FullWidthCellKeyDownEvent<Job>) => {
    const enter = event.event instanceof KeyboardEvent && event.event.key === 'Enter';
    const onAction = 'column' in event && event.column.getColId() === 'action';
    if (enter && onAction && event.data !== undefined && canCancel(event.data) && context.canAct) {
      setCancelling(event.data);
    }
  };

  async function cancel(job: Job, reason: string) {
    setCancelled(await opsApi.cancel(job.id, reason));
    list.reload();
  }

  return (
    <section className="stack">
      <PageHead title={c.title} lead={c.lead}>
        <div className="filter-tabs" role="group" aria-label={c.filter}>
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => {
                setView(option);
              }}
            >
              {c[option]}{' '}
              <span className="mono">{totals === undefined ? '—' : countOf(option, totals)}</span>
            </button>
          ))}
        </div>
      </PageHead>
      <ConnectionNotice resource={list} />
      {cancelled !== null && (
        <p className="done" role="status">
          <Icon name="check" />
          {c.cancelled(String(cancelled.id))}
        </p>
      )}
      {session.role === 'viewer' && <p className="hint">{c.viewerOnly}</p>}
      {list.data !== null && (
        <DataGrid
          rows={rows}
          columns={columns}
          label={c.grid}
          empty={c.empty}
          getRowId={({ data }) => String(data.id)}
          context={context}
          onCellKeyDown={onKey}
        />
      )}
      {cancelling !== null && (
        <ReasonDialog
          title={c.cancelTitle(String(cancelling.id))}
          lead={`${cancelling.target} · ${cancelling.reason}`}
          onConfirm={(reason) => cancel(cancelling, reason)}
          onClose={() => {
            setCancelling(null);
          }}
        />
      )}
    </section>
  );
}
