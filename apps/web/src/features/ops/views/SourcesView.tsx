import type { SourceRow, SourceState } from '@moviq/contracts';
import type { CellKeyDownEvent, FullWidthCellKeyDownEvent } from 'ag-grid-community';
import { useId, useMemo, useState } from 'react';

import { useT } from '../../../shared/i18n';
import { DataGrid } from '../../../shared/ui/DataGrid';
import { useMediaQuery } from '../../../shared/ui/useMediaQuery';
import { opsApi } from '../api';
import { countByState, sortBySeverity } from '../model/severity';
import { opsHref } from '../routes';
import { ConnectionNotice } from '../ui/ConnectionNotice';
import { PageHead } from '../ui/PageHead';
import { useResource } from '../useResource';
import { sourceColumns } from './sources/columns';

type Filter = 'all' | SourceState;

/** Enter on any cell of a row opens that source, as clicking its name does. */
function openOnEnter(event: CellKeyDownEvent<SourceRow> | FullWidthCellKeyDownEvent<SourceRow>) {
  const key = event.event instanceof KeyboardEvent ? event.event.key : null;
  if (key === 'Enter' && event.data !== undefined)
    window.location.hash = opsHref.source(event.data.id);
}

/** Every source in one grid, worst first, with a filter by state. */
export function SourcesView() {
  const t = useT();
  const c = t.ops.sources;
  const filterId = useId();
  const narrow = useMediaQuery('(max-width: 760px)');
  const [filter, setFilter] = useState<Filter>('all');
  const list = useResource('sources', (signal) => opsApi.sources(signal));
  const all = useMemo(() => list.data?.sources ?? [], [list.data]);
  const rows = useMemo(
    () => sortBySeverity(filter === 'all' ? all : all.filter((row) => row.state === filter)),
    [all, filter],
  );
  const columns = useMemo(() => sourceColumns(t, narrow), [t, narrow]);
  const counts = countByState(all);

  return (
    <section className="stack">
      <PageHead title={c.title} lead={c.lead}>
        {list.data !== null && (
          <div className="field inline">
            <label htmlFor={filterId}>{c.filter}</label>
            <select
              id={filterId}
              value={filter}
              onChange={(event) => {
                const next = counts.find((entry) => entry.state === event.target.value);
                setFilter(next === undefined ? 'all' : next.state);
              }}
            >
              <option value="all">{c.all(all.length)}</option>
              {counts.map((entry) => (
                <option key={entry.state} value={entry.state}>
                  {c.one(t.states[entry.state].label, entry.count)}
                </option>
              ))}
            </select>
          </div>
        )}
      </PageHead>
      <ConnectionNotice resource={list} />
      {list.data !== null && (
        <DataGrid
          rows={rows}
          columns={columns}
          label={c.grid}
          empty={c.empty}
          getRowId={({ data }) => data.id}
          onCellKeyDown={openOnEnter}
        />
      )}
    </section>
  );
}
