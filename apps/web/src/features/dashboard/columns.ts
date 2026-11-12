import type { TicketWallet } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';

import type { Lang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { NUMERIC } from '../../shared/ui/DataGrid';
import { productText } from '../tickets/localization';

export type TicketItem = TicketWallet['items'][number];

/** Columns shared by the overview's latest tickets and the full activity grid. */
export function ticketColumns(lang: Lang, locale: string, dateStyle: 'short' | 'medium') {
  const es = lang === 'es';
  const date: ColDef<TicketItem> = {
    headerName: es ? 'Fecha' : 'Date',
    field: 'createdAt',
    width: dateStyle === 'medium' ? 190 : 150,
    sort: 'desc',
    cellClass: 'mono',
    valueFormatter: ({ value }) =>
      typeof value === 'string'
        ? new Intl.DateTimeFormat(locale, { dateStyle, timeStyle: 'short' }).format(new Date(value))
        : '',
  };
  const product: ColDef<TicketItem> = {
    headerName: es ? 'Billete' : 'Ticket',
    flex: 1,
    minWidth: 190,
    valueGetter: ({ data }) =>
      data
        ? productText(data.product.id, data.product.name, data.product.description, lang).name
        : '',
  };
  const operator: ColDef<TicketItem> = {
    headerName: es ? 'Operador' : 'Operator',
    width: 170,
    valueGetter: ({ data }) => data?.product.operator ?? '',
  };
  const status: ColDef<TicketItem> = {
    headerName: es ? 'Estado' : 'Status',
    width: 130,
    valueGetter: ({ data }) =>
      data?.status === 'refunded' ? (es ? 'Reembolsado' : 'Refunded') : es ? 'Pagado' : 'Paid',
  };
  const amount: ColDef<TicketItem> = {
    headerName: es ? 'Importe' : 'Amount',
    width: 120,
    ...NUMERIC,
    valueGetter: ({ data }) => data?.product.price.amountMinor,
    valueFormatter: ({ data }) => (data ? formatMoney(data.product.price, locale) : ''),
  };
  const order: ColDef<TicketItem> = {
    headerName: es ? 'Pedido PayPal' : 'PayPal order',
    field: 'paypalOrderId',
    width: 210,
    cellClass: 'mono',
    valueFormatter: ({ data }) => data?.paypalOrderId ?? '—',
  };
  return { date, product, operator, status, amount, order };
}
