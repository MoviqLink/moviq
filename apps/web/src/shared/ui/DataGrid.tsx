import {
  CellStyleModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  ValidationModule,
  themeQuartz,
  type CellKeyDownEvent,
  type ColDef,
  type FullWidthCellKeyDownEvent,
  type GetRowIdFunc,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';

// Only what the grids use (sorting, pinning, flex and keyboard come with the core); in development
// the validator names any module a grid still needs.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellStyleModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);

/** AG Grid Community drawn with the page's own tokens, so light and dark follow automatically. */
const theme = themeQuartz.withParams({
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  headerBackgroundColor: 'var(--surface)',
  headerTextColor: 'var(--muted)',
  borderColor: 'var(--line)',
  accentColor: 'var(--accent)',
  rowHoverColor: 'var(--hover)',
  selectedRowBackgroundColor: 'var(--hover)',
  oddRowBackgroundColor: 'var(--surface)',
  fontFamily: 'inherit',
  fontSize: 13.5,
  headerFontSize: 12,
  headerFontWeight: 600,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
  headerColumnBorder: false,
  rowHeight: 52,
  headerHeight: 40,
  spacing: 8,
  cellHorizontalPadding: 14,
  // A short list should end where its rows end, with room for one line when it is empty.
  autoHeightMinBodyHeight: 52,
});

/** Numeric columns: right-aligned, in mono, so figures line up. */
export const NUMERIC: Pick<ColDef, 'type' | 'cellClass' | 'headerClass'> = {
  type: 'rightAligned',
  cellClass: ['mono', 'ag-right-aligned-cell'],
  headerClass: 'ag-right-aligned-header',
};

interface Props<T> {
  readonly rows: T[];
  readonly columns: ColDef<T>[];
  readonly label: string;
  readonly empty: string;
  readonly getRowId: GetRowIdFunc<T>;
  /** Passed to cell renderers, for what they need from the screen (roles, actions). */
  readonly context?: unknown;
  readonly onCellKeyDown?: (event: CellKeyDownEvent<T> | FullWidthCellKeyDownEvent<T>) => void;
}

/** A data grid labelled for assistive technology, sized to its rows, without animations. */
export function DataGrid<T>(props: Props<T>) {
  const { rows, columns, label, empty, getRowId, onCellKeyDown, context } = props;
  return (
    <div className="grid-wrap" role="region" aria-label={label}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        getRowId={getRowId}
        context={context}
        {...(onCellKeyDown === undefined ? {} : { onCellKeyDown })}
        domLayout="autoHeight"
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        animateRows={false}
        suppressCellFocus={false}
        enableCellTextSelection
        ensureDomOrder
        overlayNoRowsTemplate={`<span class="grid-empty">${empty}</span>`}
      />
    </div>
  );
}
