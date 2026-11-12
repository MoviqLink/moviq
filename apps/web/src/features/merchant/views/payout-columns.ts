import type { ColDef } from 'ag-grid-community';

import { formatMoney } from '../../../shared/journey/money';
import { formatCityDay, formatCityTime } from '../../../shared/time/city';
import { NUMERIC } from '../../../shared/ui/DataGrid';
import type { PayoutView } from '../schemas';
import type { MerchantDict } from '../texts';

type Amount = 'gross' | 'refunds' | 'fee' | 'net';

/** Payout batches: when, what they cover, the amounts the server set and PayPal's state. */
export function payoutColumns(t: MerchantDict, locale: string): ColDef<PayoutView>[] {
  const when = (value: unknown) =>
    typeof value === 'string'
      ? `${formatCityDay(value, locale)} · ${formatCityTime(value, locale)}`
      : '';
  const amount = (key: Amount, headerName: string): ColDef<PayoutView> => ({
    headerName,
    colId: key,
    width: 130,
    ...NUMERIC,
    valueGetter: ({ data }) => data?.[key].amountMinor ?? 0,
    valueFormatter: ({ data }) => (data === undefined ? '' : formatMoney(data[key], locale)),
  });
  return [
    {
      headerName: t.payouts.created,
      field: 'createdAt',
      sort: 'desc',
      width: 220,
      cellClass: 'mono',
      valueFormatter: ({ value }) => when(value),
    },
    {
      headerName: t.payouts.until,
      field: 'until',
      width: 220,
      cellClass: 'mono',
      valueFormatter: ({ value }) => when(value),
    },
    amount('gross', t.payouts.gross),
    amount('refunds', t.payouts.refunds),
    amount('fee', t.payouts.fee),
    amount('net', t.payouts.net),
    {
      headerName: t.payouts.status,
      field: 'status',
      width: 150,
      valueFormatter: ({ data }) => (data === undefined ? '' : t.payouts.states[data.status]),
    },
    { headerName: t.payouts.detail, field: 'detail', flex: 1, minWidth: 200 },
  ];
}
