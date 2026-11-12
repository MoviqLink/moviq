import type { TicketWallet } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang, type Lang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { DataGrid, NUMERIC } from '../../shared/ui/DataGrid';
import { useLiveResource } from '../demo/useLiveResource';
import { ticketsApi } from '../tickets/api';
import { productText } from '../tickets/localization';
import './wallet.css';

type TicketItem = TicketWallet['items'][number];

const WORDS = {
  en: {
    kicker: 'WALLET · PAYPAL SANDBOX',
    title: 'Refunds',
    lead: 'Tickets whose payment PayPal returned, with the order and the refunded capture.',
    refresh: 'Refresh',
    loading: 'Loading refunds…',
    failed: 'Refunds are unavailable right now. Try again in a moment.',
    stale: 'Could not refresh. The list shown may be out of date.',
    label: 'Refunds',
    empty: 'No refunds. A refunded ticket appears here with its PayPal refund.',
    total: 'Refunded',
  },
  es: {
    kicker: 'BILLETERA · PAYPAL SANDBOX',
    title: 'Reembolsos',
    lead: 'Billetes cuyo pago devolvió PayPal, con el pedido y la captura reembolsada.',
    refresh: 'Actualizar',
    loading: 'Cargando reembolsos…',
    failed: 'Los reembolsos no están disponibles ahora mismo. Inténtalo de nuevo en un momento.',
    stale: 'No se pudo actualizar. La lista mostrada puede estar desactualizada.',
    label: 'Reembolsos',
    empty: 'No hay reembolsos. Un billete reembolsado aparece aquí con su reembolso de PayPal.',
    total: 'Reembolsado',
  },
} as const;

function refundColumns(lang: Lang, locale: string): ColDef<TicketItem>[] {
  const es = lang === 'es';
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return [
    {
      headerName: es ? 'Fecha de compra' : 'Bought on',
      field: 'createdAt',
      width: 190,
      sort: 'desc',
      cellClass: 'mono',
      valueFormatter: ({ value }) =>
        typeof value === 'string' ? when.format(new Date(value)) : '',
    },
    {
      headerName: es ? 'Billete' : 'Ticket',
      flex: 1,
      minWidth: 200,
      valueGetter: ({ data }) =>
        data
          ? productText(data.product.id, data.product.name, data.product.description, lang).name
          : '',
    },
    {
      headerName: es ? 'Operador' : 'Operator',
      width: 170,
      valueGetter: ({ data }) => data?.product.operator ?? '',
    },
    {
      headerName: es ? 'Importe' : 'Amount',
      width: 130,
      ...NUMERIC,
      valueGetter: ({ data }) => data?.product.price.amountMinor,
      valueFormatter: ({ data }) => (data ? formatMoney(data.product.price, locale) : ''),
    },
    {
      headerName: es ? 'Pedido PayPal' : 'PayPal order',
      field: 'paypalOrderId',
      width: 210,
      cellClass: 'mono',
      valueFormatter: ({ data }) => data?.paypalOrderId ?? '—',
    },
    {
      headerName: es ? 'Captura reembolsada' : 'Refunded capture',
      field: 'paypalCaptureId',
      width: 210,
      cellClass: 'mono',
      valueFormatter: ({ data }) => data?.paypalCaptureId ?? '—',
    },
  ];
}

/** Refunded tickets, each with its PayPal order and capture. */
export function RefundsScreen() {
  const lang = useLang();
  const locale = useLocale();
  const w = WORDS[lang];
  const tickets = useLiveResource(ticketsApi.wallet);
  const columns = useMemo(() => refundColumns(lang, locale), [lang, locale]);
  const refunded = useMemo(
    () => (tickets.data?.items ?? []).filter((item) => item.status === 'refunded'),
    [tickets.data],
  );
  const totalMinor = refunded.reduce((sum, item) => sum + item.product.price.amountMinor, 0);
  return (
    <main id="main" className="page wal-page" tabIndex={-1}>
      <header className="wal-head">
        <p className="wal-kicker">{w.kicker}</p>
        <h1>{w.title}</h1>
        <p className="wal-lead">{w.lead}</p>
      </header>
      <section className="wal-card wal-grid" aria-label={w.label}>
        <div className="wal-grid-head">
          <h2>
            {w.label}
            {refunded.length > 0 && (
              <span className="wal-count">
                {w.total} · {formatMoney({ amountMinor: totalMinor, currency: 'USD' }, locale)}
              </span>
            )}
          </h2>
          <button className="btn small" type="button" onClick={tickets.refresh}>
            {w.refresh}
          </button>
        </div>
        {tickets.data === null ? (
          <p className="wal-detail" role={tickets.loading ? 'status' : 'alert'}>
            {tickets.loading ? w.loading : w.failed}
          </p>
        ) : (
          <>
            {tickets.error && (
              <p className="wal-detail" role="alert">
                {w.stale}
              </p>
            )}
            {refunded.length === 0 ? (
              <p className="wal-empty-state">{w.empty}</p>
            ) : (
              <DataGrid<TicketItem>
                rows={refunded}
                columns={columns}
                label={w.label}
                empty={w.empty}
                getRowId={({ data }) => data.id}
              />
            )}
          </>
        )}
      </section>
    </main>
  );
}
