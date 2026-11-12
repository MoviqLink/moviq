import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { useMemo } from 'react';

import type { auditListSchema } from '@moviq/contracts';
import { useT } from '../../../shared/i18n';
import type { Dict } from '../../../shared/i18n/en';
import { DataGrid } from '../../../shared/ui/DataGrid';
import { opsApi } from '../api';
import { ConnectionNotice } from '../ui/ConnectionNotice';
import { Clock } from '../ui/LiveTime';
import { PageHead } from '../ui/PageHead';
import { useResource } from '../useResource';

type Entry = ReturnType<typeof auditListSchema.parse>['entries'][number];

function AtCell({ data }: CustomCellRendererProps<Entry>) {
  return data === undefined ? null : <Clock at={data.at} />;
}

function auditColumns(t: Dict): ColDef<Entry>[] {
  const c = t.ops.audit;
  return [
    {
      colId: 'at',
      headerName: c.colAt,
      field: 'at',
      cellRenderer: AtCell,
      width: 150,
      sort: 'desc',
    },
    { colId: 'actor', headerName: c.colActor, field: 'actor', width: 160, cellClass: 'mono' },
    { colId: 'action', headerName: c.colAction, field: 'action', width: 190, cellClass: 'mono' },
    { colId: 'target', headerName: c.colTarget, field: 'target', width: 220, cellClass: 'mono' },
    {
      colId: 'reason',
      headerName: c.colReason,
      field: 'reason',
      valueFormatter: ({ data }) => data?.reason ?? '—',
      flex: 1,
      minWidth: 240,
    },
  ];
}

/** Sensitive actions: who did what, on what, and the reason they gave. */
export function AuditView() {
  const t = useT();
  const log = useResource('audit', (signal) => opsApi.audit(signal));
  const columns = useMemo(() => auditColumns(t), [t]);
  return (
    <section className="stack">
      <PageHead title={t.ops.audit.title} lead={t.ops.audit.lead} />
      <ConnectionNotice resource={log} />
      {log.data !== null && (
        <DataGrid
          rows={log.data.entries}
          columns={columns}
          label={t.ops.audit.grid}
          empty={t.ops.audit.empty}
          getRowId={({ data }) => String(data.id)}
        />
      )}
    </section>
  );
}
