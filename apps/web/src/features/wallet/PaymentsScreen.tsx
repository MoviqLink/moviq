import type { Money, TicketWallet, TripWallet } from '@moviq/contracts';
import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang, type Lang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { DataGrid, NUMERIC } from '../../shared/ui/DataGrid';
import { useLiveResource } from '../demo/useLiveResource';
import { ticketsApi } from '../tickets/api';
import { productText } from '../tickets/localization';
import { walletApi } from './api';
import './wallet.css';

/** One payment in the list: a top-up of the trip wallet or a ticket. */
interface PaymentRow {
  readonly id: string;
  readonly at: string;
  readonly concept: string;
  readonly kind: 'top-up' | 'ticket';
  readonly paypalOrderId: string | null;
  readonly money: Money;
  readonly status: 'added' | 'paid' | 'refunded';
}

const WORDS = {
  en: {
    kicker: 'WALLET · PAYPAL SANDBOX',
    title: 'Payments',
    lead: 'Every payment of your trips: money added with PayPal and each ticket bought.',
    added: 'Added with PayPal',
    spent: 'Spent on tickets',
    balance: 'Balance',
    refresh: 'Refresh',
    loading: 'Loading payments…',
    failed: 'Payments are unavailable right now. Try again in a moment.',
    partial: 'Part of the payments could not be loaded; the list may be incomplete.',
    label: 'Payments',
    empty: 'No payments yet.',
    topUpConcept: 'Money added to the trip wallet',
  },
  es: {
    kicker: 'BILLETERA · PAYPAL SANDBOX',
    title: 'Pagos',
    lead: 'Cada pago de tus viajes: el dinero añadido con PayPal y cada billete comprado.',
    added: 'Añadido con PayPal',
    spent: 'Gastado en billetes',
    balance: 'Saldo',
    refresh: 'Actualizar',
    loading: 'Cargando pagos…',
    failed: 'Los pagos no están disponibles ahora mismo. Inténtalo de nuevo en un momento.',
    partial: 'Parte de los pagos no se pudo cargar; la lista puede estar incompleta.',
    label: 'Pagos',
    empty: 'Todavía no hay pagos.',
    topUpConcept: 'Dinero añadido a la billetera de viaje',
  },
} as const;

function rowsOf(wallet: TripWallet | null, tickets: TicketWallet | null, lang: Lang): PaymentRow[] {
  const topUps: PaymentRow[] = (wallet?.movements ?? [])
    .filter((movement) => movement.kind === 'top-up')
    .map((movement) => ({
      id: `top-up:${movement.id}`,
      at: movement.at,
      concept: WORDS[lang].topUpConcept,
      kind: 'top-up',
      paypalOrderId: movement.paypalOrderId,
      money: { amountMinor: movement.amountMinor, currency: movement.currency },
      status: 'added',
    }));
  const bought: PaymentRow[] = (tickets?.items ?? []).map((item) => ({
    id: `ticket:${item.id}`,
    at: item.createdAt,
    concept: productText(item.product.id, item.product.name, item.product.description, lang).name,
    kind: 'ticket',
    paypalOrderId: item.paypalOrderId,
    money: { ...item.product.price, amountMinor: -item.product.price.amountMinor },
    status: item.status === 'refunded' ? 'refunded' : 'paid',
  }));
  return [...topUps, ...bought];
}

function paymentColumns(lang: Lang, locale: string): ColDef<PaymentRow>[] {
  const es = lang === 'es';
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const statusText = {
    added: es ? 'Añadido' : 'Added',
    paid: es ? 'Pagado' : 'Paid',
    refunded: es ? 'Reembolsado' : 'Refunded',
  } as const;
  return [
    {
      headerName: es ? 'Fecha' : 'Date',
      field: 'at',
      width: 190,
      sort: 'desc',
      cellClass: 'mono',
      valueFormatter: ({ value }) =>
        typeof value === 'string' ? when.format(new Date(value)) : '',
    },
    { headerName: es ? 'Concepto' : 'Concept', field: 'concept', flex: 1, minWidth: 220 },
    {
      headerName: es ? 'Tipo' : 'Type',
      width: 120,
      valueGetter: ({ data }) =>
        data?.kind === 'top-up' ? (es ? 'Recarga' : 'Top-up') : es ? 'Billete' : 'Ticket',
    },
    {
      headerName: es ? 'Método' : 'Method',
      width: 140,
      valueGetter: ({ data }) =>
        data?.paypalOrderId === null ? (es ? 'Billetera de viaje' : 'Trip wallet') : 'PayPal',
    },
    {
      headerName: es ? 'Importe' : 'Amount',
      width: 130,
      ...NUMERIC,
      valueGetter: ({ data }) => data?.money.amountMinor,
      valueFormatter: ({ data }) =>
        data ? `${data.money.amountMinor > 0 ? '+' : ''}${formatMoney(data.money, locale)}` : '',
    },
    {
      headerName: es ? 'Estado' : 'Status',
      width: 130,
      valueGetter: ({ data }) => (data ? statusText[data.status] : ''),
    },
    {
      headerName: es ? 'Pedido PayPal' : 'PayPal order',
      field: 'paypalOrderId',
      width: 210,
      cellClass: 'mono',
      valueFormatter: ({ data }) => data?.paypalOrderId ?? '—',
    },
  ];
}

/** Every payment: wallet top-ups and tickets in one grid, with the wallet's three figures. */
export function PaymentsScreen() {
  const lang = useLang();
  const locale = useLocale();
  const w = WORDS[lang];
  const wallet = useLiveResource(walletApi.wallet);
  const tickets = useLiveResource(ticketsApi.wallet);
  const columns = useMemo(() => paymentColumns(lang, locale), [lang, locale]);
  const rows = useMemo(
    () => rowsOf(wallet.data, tickets.data, lang),
    [wallet.data, tickets.data, lang],
  );
  const nothing = wallet.data === null && tickets.data === null;
  const loading = wallet.loading || tickets.loading;
  return (
    <main id="main" className="page wal-page" tabIndex={-1}>
      <header className="wal-head">
        <p className="wal-kicker">{w.kicker}</p>
        <h1>{w.title}</h1>
        <p className="wal-lead">{w.lead}</p>
      </header>
      {wallet.data !== null && (
        <dl className="wal-figures">
          <div>
            <dt>{w.added}</dt>
            <dd>{formatMoney(wallet.data.added, locale)}</dd>
          </div>
          <div>
            <dt>{w.spent}</dt>
            <dd>{formatMoney(wallet.data.spent, locale)}</dd>
          </div>
          <div>
            <dt>{w.balance}</dt>
            <dd>{formatMoney(wallet.data.balance, locale)}</dd>
          </div>
        </dl>
      )}
      <section className="wal-card wal-grid" aria-label={w.label}>
        <div className="wal-grid-head">
          <h2>{w.label}</h2>
          <button
            className="btn small"
            type="button"
            onClick={() => {
              wallet.refresh();
              tickets.refresh();
            }}
          >
            {w.refresh}
          </button>
        </div>
        {nothing ? (
          <p className="wal-detail" role={loading ? 'status' : 'alert'}>
            {loading ? w.loading : w.failed}
          </p>
        ) : (
          <>
            {(wallet.error || tickets.error) && (
              <p className="wal-detail" role="alert">
                {w.partial}
              </p>
            )}
            <DataGrid<PaymentRow>
              rows={rows}
              columns={columns}
              label={w.label}
              empty={w.empty}
              getRowId={({ data }) => data.id}
            />
          </>
        )}
      </section>
    </main>
  );
}
