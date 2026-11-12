import type { SourceRow } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';

import type { Dict } from '../../../../shared/i18n/en';
import { NUMERIC } from '../../../../shared/ui/DataGrid';
import { severityRank } from '../../model/severity';
import {
  AgeCell,
  ErrorCell,
  LatencyCell,
  NextCell,
  RhythmCell,
  SourceCell,
  SourceStateCell,
  StateCell,
  SuccessCell,
} from './cells';

const instant = (value: string | null | undefined): number =>
  value === null || value === undefined ? 0 : Date.parse(value);

const bySeverity = (a: SourceRow['state'], b: SourceRow['state']) =>
  severityRank(a) - severityRank(b);

/** The state and source columns: apart on wide screens, merged on narrow ones. */
function leading(t: Dict, narrow: boolean): ColDef<SourceRow>[] {
  const c = t.ops.sources;
  if (narrow) {
    return [
      {
        colId: 'source',
        headerName: c.colSource,
        field: 'state',
        cellRenderer: SourceStateCell,
        comparator: bySeverity,
        width: 190,
      },
    ];
  }
  return [
    {
      colId: 'state',
      headerName: c.colState,
      field: 'state',
      cellRenderer: StateCell,
      comparator: bySeverity,
      pinned: 'left',
      width: 172,
    },
    {
      colId: 'source',
      headerName: c.colSource,
      field: 'title',
      cellRenderer: SourceCell,
      pinned: 'left',
      width: 240,
    },
  ];
}

/** The sources grid. Sorting a column compares the facts, not the words on screen. */
export function sourceColumns(t: Dict, narrow: boolean): ColDef<SourceRow>[] {
  const c = t.ops.sources;
  return [
    ...leading(t, narrow),
    {
      colId: 'age',
      headerName: c.colAge,
      field: 'ageSeconds',
      cellRenderer: AgeCell,
      flex: 2,
      minWidth: 180,
    },
    {
      colId: 'coverage',
      headerName: c.colCoverage,
      field: 'coverage',
      flex: 2,
      minWidth: 110,
    },
    {
      colId: 'success',
      headerName: c.colSuccess,
      valueGetter: ({ data }) => instant(data?.lastSuccessAt),
      cellRenderer: SuccessCell,
      flex: 2,
      minWidth: 150,
    },
    {
      colId: 'error',
      headerName: c.colError,
      valueGetter: ({ data }) => data?.lastError?.code ?? '',
      cellRenderer: ErrorCell,
      flex: 2,
      minWidth: 128,
    },
    {
      colId: 'latency',
      headerName: c.colLatency,
      field: 'latencyMs',
      cellRenderer: LatencyCell,
      flex: 1,
      minWidth: 90,
      ...NUMERIC,
    },
    {
      colId: 'rhythm',
      headerName: c.colRhythm,
      field: 'intervalSeconds',
      cellRenderer: RhythmCell,
      flex: 2,
      minWidth: 170,
    },
    {
      colId: 'next',
      headerName: c.colNext,
      valueGetter: ({ data }) => instant(data?.nextRunAt),
      cellRenderer: NextCell,
      flex: 2,
      minWidth: 140,
    },
  ];
}
