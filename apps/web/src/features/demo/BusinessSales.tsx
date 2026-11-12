import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { DataGrid, NUMERIC } from '../../shared/ui/DataGrid';
import { localizedNotice, productText } from '../tickets/localization';
import type { PartnerReport } from './api';
import { useDemoT } from './text';

type Sale = PartnerReport['items'][number];

function saleColumns(
  lang: 'es' | 'en',
  locale: string,
  currency: PartnerReport['totals']['currency'],
): ColDef<Sale>[] {
  const es = lang === 'es';
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return [
    {
      headerName: es ? 'Fecha y hora' : 'Date and time',
      field: 'createdAt',
      width: 180,
      sort: 'desc',
      cellClass: 'mono',
      valueFormatter: ({ value }) =>
        typeof value === 'string' ? when.format(new Date(value)) : '',
    },
    {
      headerName: es ? 'Producto' : 'Product',
      flex: 1,
      minWidth: 200,
      valueGetter: ({ data }) =>
        data
          ? productText(data.product.id, data.product.name, data.product.description, lang).name
          : '',
    },
    {
      headerName: es ? 'Operador' : 'Operator',
      width: 150,
      valueGetter: ({ data }) => data?.product.operator ?? '',
    },
    {
      headerName: es ? 'Importe' : 'Amount',
      width: 130,
      ...NUMERIC,
      field: 'amountMinor',
      valueFormatter: ({ data }) =>
        data ? formatMoney({ amountMinor: data.amountMinor, currency }, locale) : '',
    },
    {
      headerName: es ? 'Estado' : 'Status',
      field: 'status',
      width: 140,
      cellClass: ({ value }) => (value === 'refunded' ? 'biz-status is-refunded' : 'biz-status'),
      valueFormatter: ({ value }) =>
        value === 'refunded' ? (es ? 'Reembolsada' : 'Refunded') : es ? 'Confirmada' : 'Confirmed',
    },
    {
      headerName: es ? 'Captura de PayPal' : 'PayPal capture',
      field: 'paypalCaptureId',
      width: 210,
      cellClass: 'mono',
      valueFormatter: ({ data }) => data?.paypalCaptureId ?? '—',
    },
    {
      headerName: es ? 'Pago' : 'Payment',
      field: 'paymentId',
      width: 300,
      cellClass: 'mono',
    },
  ];
}

function Totals({ totals }: { readonly totals: PartnerReport['totals'] }) {
  const t = useDemoT();
  const locale = useLocale();
  const money = (amountMinor: number) =>
    formatMoney({ amountMinor, currency: totals.currency }, locale);
  return (
    <dl className="biz-kpis">
      <div className="biz-kpi">
        <dt>{t.sales}</dt>
        <dd className="mono">{totals.sales}</dd>
        <dd className="biz-kpi-hint">{t.salesHint}</dd>
      </div>
      <div className="biz-kpi">
        <dt>{t.gross}</dt>
        <dd className="mono">{money(totals.amountMinor)}</dd>
        <dd className="biz-kpi-hint">{t.grossHint}</dd>
      </div>
      <div className="biz-kpi">
        <dt>{t.refunded}</dt>
        <dd className="mono">{money(totals.refundedMinor)}</dd>
        <dd className="biz-kpi-hint">{t.refundCount(totals.refunded)}</dd>
      </div>
      <div className="biz-kpi is-net">
        <dt>{t.net}</dt>
        <dd className="mono">{money(totals.netMinor)}</dd>
        <dd className="biz-kpi-hint">{t.netHint}</dd>
      </div>
    </dl>
  );
}

export function Sales({ report }: { readonly report: PartnerReport }) {
  const t = useDemoT();
  const lang = useLang();
  const locale = useLocale();
  const currency = report.totals.currency;
  const columns = useMemo(() => saleColumns(lang, locale, currency), [lang, locale, currency]);
  return (
    <section id="business-sales" className="biz-section" aria-labelledby="business-sales-title">
      <h2 id="business-sales-title">{t.sales}</h2>
      <Totals totals={report.totals} />
      <div className="biz-subhead">
        <h3>{t.transactions}</h3>
        <p className="biz-note">{localizedNotice(report.notice, lang)}</p>
        {report.hasMore && <p className="biz-note">{t.more}</p>}
      </div>
      <DataGrid<Sale>
        rows={report.items}
        columns={columns}
        label={t.transactions}
        empty={t.noSales}
        getRowId={({ data }) => data.id}
      />
    </section>
  );
}
