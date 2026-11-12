import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';

import { formatMoney } from '../../../shared/journey/money';
import { formatCityTime } from '../../../shared/time/city';
import { NUMERIC } from '../../../shared/ui/DataGrid';
import { lineText, nextStep } from '../model/counter';
import { merchantHref } from '../routes';
import type { KitchenTicket } from '../schemas';
import type { MerchantDict } from '../texts';

/** What the grid needs from the screen: its words, locale, and how to move a ticket. */
export interface TicketsContext {
  readonly t: MerchantDict;
  readonly locale: string;
  readonly busy: boolean;
  readonly onMove: (ticket: KitchenTicket, to: 'preparing' | 'ready') => void;
}

type Cell = CustomCellRendererProps<KitchenTicket, unknown, TicketsContext>;

function StatusCell({ data, context }: Cell) {
  if (data === undefined) return null;
  return (
    <span className={`mc-status mc-status-${data.status}`}>{context.t.status[data.status]}</span>
  );
}

function ActionCell({ data, context }: Cell) {
  if (data === undefined) return null;
  const step = nextStep(data.status);
  const t = context.t.tickets;
  if (step === null) return null;
  if (step === 'scan') {
    return (
      <a className="btn small" href={merchantHref.scan}>
        {t.scan}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="btn small"
      disabled={context.busy}
      aria-label={`${step === 'preparing' ? t.start : t.ready} · ${data.code}`}
      onClick={() => {
        context.onMove(data, step);
      }}
    >
      {step === 'preparing' ? t.start : t.ready}
    </button>
  );
}

/**
 * The kitchen tickets, by pickup time: what to make, for whom, its state and the next step,
 * which stays pinned on the right on a narrow screen.
 */
export function ticketColumns(
  t: MerchantDict,
  locale: string,
  narrow: boolean,
): ColDef<KitchenTicket>[] {
  return [
    {
      headerName: t.tickets.pickup,
      field: 'pickupAt',
      sort: 'asc',
      width: 110,
      cellClass: 'mono',
      valueFormatter: ({ value }) =>
        typeof value === 'string' ? formatCityTime(value, locale) : '',
    },
    { headerName: t.tickets.code, field: 'code', width: 100, cellClass: 'mono' },
    { headerName: t.tickets.alias, field: 'alias', width: 130 },
    {
      headerName: t.tickets.lines,
      colId: 'lines',
      flex: 1,
      minWidth: 220,
      valueGetter: ({ data }) => data?.lines.map(lineText).join(' + ') ?? '',
    },
    {
      headerName: t.tickets.status,
      field: 'status',
      width: 140,
      cellRenderer: StatusCell,
    },
    {
      headerName: t.tickets.held,
      colId: 'held',
      width: 120,
      ...NUMERIC,
      valueGetter: ({ data }) => data?.payment.authorized.amountMinor ?? 0,
      valueFormatter: ({ data }) =>
        data === undefined ? '' : formatMoney(data.payment.authorized, locale),
    },
    {
      headerName: t.tickets.action,
      colId: 'action',
      width: narrow ? 150 : 170,
      // On a phone the next step stays in sight while the rest of the ticket scrolls.
      ...(narrow ? { pinned: 'right' as const } : {}),
      sortable: false,
      cellRenderer: ActionCell,
    },
  ];
}
