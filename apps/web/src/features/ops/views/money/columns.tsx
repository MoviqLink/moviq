import type { MoneyObligation } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';

import { useLocale } from '../../../../shared/i18n';
import { formatMoney } from '../../../../shared/journey/money';
import { NUMERIC } from '../../../../shared/ui/DataGrid';
import { Ago, Until } from '../../ui/LiveTime';
import { useMoneyT, type MoneyDict } from './texts';

type Cell = CustomCellRendererProps<MoneyObligation>;

/** What the obligation is, with the record it is followed under. */
export function KindCell({ data }: Cell) {
  const t = useMoneyT();
  if (data === undefined) return null;
  return (
    <span className="cell-stack">
      <span>{t.kinds[data.kind]}</span>
      <span className="cell-sub mono">{data.reference}</span>
    </span>
  );
}

const LOOK = { attempts: 'st-unavailable', age: 'st-unavailable', none: 'st-unknown' } as const;

function escalationOf(t: MoneyDict, data: MoneyObligation) {
  const key = data.escalation ?? 'none';
  const word = { attempts: t.byAttempts, age: t.byAge, none: t.retrying }[key];
  return { word, look: LOOK[key] };
}

/** Escalated in the colour of an unavailable source; still retrying in that of an unknown one. */
export function EscalationCell({ data }: Cell) {
  const t = useMoneyT();
  if (data === undefined) return null;
  const { word, look } = escalationOf(t, data);
  return <span className={`outcome ${look}`}>{word}</span>;
}

/** On narrow screens the escalation rides with the obligation, so the amount stays in view. */
function KindEscalationCell({ data }: Cell) {
  const t = useMoneyT();
  if (data === undefined) return null;
  const { word, look } = escalationOf(t, data);
  return (
    <span className="cell-stack">
      <span className={`outcome ${look}`}>{t.kinds[data.kind]}</span>
      <span className="cell-sub">
        {word} · <span className="mono">{data.reference}</span>
      </span>
    </span>
  );
}

function AmountCell({ data }: Cell) {
  const locale = useLocale();
  return data === undefined ? null : <>{formatMoney(data.amount, locale)}</>;
}

/** PayPal's last answer, already cleaned by the server; the whole line on hover. */
function ErrorCell({ data }: Cell) {
  if (data === undefined) return null;
  if (data.lastError === null) return <span className="muted">—</span>;
  return (
    <span className="money-error mono" title={data.lastError}>
      {data.lastError}
    </span>
  );
}

function SinceCell({ data }: Cell) {
  return data === undefined ? null : <Ago at={data.since} />;
}

function NextCell({ data }: Cell) {
  return data === undefined ? null : <Until at={data.nextCheckAt} />;
}

type Column = ColDef<MoneyObligation>;

function columnsFor(t: MoneyDict): Record<string, Column> {
  return {
    escalation: {
      colId: 'escalation',
      headerName: t.colEscalation,
      cellRenderer: EscalationCell,
      comparator: (_a, _b, x, y) =>
        Number(y.data?.escalation !== null) - Number(x.data?.escalation !== null),
      width: 180,
      pinned: 'left',
    },
    kind: { colId: 'kind', headerName: t.colKind, cellRenderer: KindCell, flex: 1, minWidth: 230 },
    kindNarrow: {
      colId: 'kind',
      headerName: t.colKind,
      cellRenderer: KindEscalationCell,
      width: 230,
    },
    status: {
      colId: 'status',
      headerName: t.colStatus,
      field: 'status',
      width: 180,
      cellClass: 'mono',
    },
    amount: {
      colId: 'amount',
      headerName: t.colAmount,
      valueGetter: ({ data }) => data?.amount.amountMinor,
      cellRenderer: AmountCell,
      width: 110,
      ...NUMERIC,
    },
    since: {
      colId: 'since',
      headerName: t.colSince,
      field: 'since',
      cellRenderer: SinceCell,
      width: 180,
    },
    attempts: {
      colId: 'attempts',
      headerName: t.colAttempts,
      field: 'attempts',
      valueFormatter: ({ value }) => (typeof value === 'number' ? String(value) : '—'),
      width: 100,
      ...NUMERIC,
    },
    error: {
      colId: 'error',
      headerName: t.colError,
      field: 'lastError',
      cellRenderer: ErrorCell,
      flex: 1.4,
      minWidth: 240,
    },
    next: {
      colId: 'next',
      headerName: t.colNext,
      field: 'nextCheckAt',
      cellRenderer: NextCell,
      width: 150,
    },
  };
}

const WIDE = ['escalation', 'kind', 'status', 'amount', 'since', 'attempts', 'error', 'next'];
const NARROW = ['kindNarrow', 'amount', 'since', 'error', 'attempts', 'next', 'status'];

/** Wide, the escalation is pinned first; narrow, it rides with the obligation and nothing is pinned. */
export function moneyColumns(t: MoneyDict, narrow: boolean): Column[] {
  const all = columnsFor(t);
  return (narrow ? NARROW : WIDE).flatMap((id) => all[id] ?? []);
}
