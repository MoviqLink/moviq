import type { TicketCatalog } from '@moviq/contracts';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useMemo, useState } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { LangSwitch } from '../../shared/i18n/LangSwitch';
import { formatMoney } from '../../shared/journey/money';
import { ThemeSwitch } from '../../shared/theme/ThemeSwitch';
import { DataGrid, NUMERIC } from '../../shared/ui/DataGrid';
import { Logo } from '../../shared/ui/Logo';
import { ticketsApi } from '../tickets/api';
import { productText } from '../tickets/localization';
import { demoApi } from './api';
import { Sales } from './BusinessSales';
import { useDemoT } from './text';
import { useLiveResource } from './useLiveResource';
import { setTravellerEntered } from './travellerSession';
import './demo.css';

type Product = TicketCatalog['products'][number];

function Refresh({
  loading,
  error,
  refresh,
}: {
  readonly loading: boolean;
  readonly error: boolean;
  readonly refresh: () => void;
}) {
  const t = useDemoT();
  return (
    <div className="biz-refresh">
      {loading && <span role="status">{t.loading}</span>}
      {error && (
        <span role="alert">
          {t.failed} {t.stale}
        </span>
      )}
      <button className="btn small" type="button" onClick={refresh}>
        {t.refresh}
      </button>
    </div>
  );
}

function OfficialFare({ data }: ICellRendererParams<Product>) {
  const es = useLang() === 'es';
  if (data === undefined) return null;
  return (
    <a className="link" href={data.officialUrl} target="_blank" rel="noopener noreferrer">
      {es ? 'Tarifa oficial' : 'Official fare'}
    </a>
  );
}

function catalogColumns(lang: 'es' | 'en', locale: string): ColDef<Product>[] {
  const es = lang === 'es';
  return [
    {
      headerName: es ? 'Producto' : 'Product',
      flex: 1,
      minWidth: 220,
      valueGetter: ({ data }) =>
        data ? productText(data.id, data.name, data.description, lang).name : '',
    },
    {
      headerName: es ? 'Operador de referencia' : 'Reference operator',
      field: 'operator',
      width: 200,
    },
    {
      headerName: es ? 'Precio' : 'Price',
      width: 120,
      ...NUMERIC,
      valueGetter: ({ data }) => data?.price.amountMinor,
      valueFormatter: ({ data }) => (data ? formatMoney(data.price, locale) : ''),
    },
    { headerName: es ? 'Viajes' : 'Rides', field: 'rides', width: 100, ...NUMERIC },
    {
      headerName: es ? 'Fuente' : 'Source',
      width: 150,
      sortable: false,
      cellRenderer: OfficialFare,
    },
  ];
}

function BusinessCatalog() {
  const t = useDemoT();
  const lang = useLang();
  const locale = useLocale();
  const catalog = useLiveResource(ticketsApi.catalog);
  const columns = useMemo(() => catalogColumns(lang, locale), [lang, locale]);
  return (
    <section id="business-catalog" className="biz-section" aria-labelledby="business-catalog-title">
      <div className="biz-section-head">
        <div>
          <h2 id="business-catalog-title">{t.catalog}</h2>
          <p className="biz-note">{t.catalogLead}</p>
        </div>
        <Refresh {...catalog} />
      </div>
      {catalog.data && (
        <DataGrid<Product>
          rows={[...catalog.data.products]}
          columns={columns}
          label={t.catalog}
          empty={t.loading}
          getRowId={({ data }) => data.id}
        />
      )}
    </section>
  );
}

function BusinessHeader({
  logout,
  leaving,
}: {
  readonly logout: () => void;
  readonly leaving: boolean;
}) {
  const t = useDemoT();
  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };
  return (
    <header className="biz-header">
      <Logo />
      <nav className="biz-nav" aria-label={t.sections}>
        <button
          type="button"
          onClick={() => {
            go('business-sales');
          }}
        >
          {t.sales}
        </button>
        <button
          type="button"
          onClick={() => {
            go('business-catalog');
          }}
        >
          {t.catalog}
        </button>
      </nav>
      <div className="biz-controls">
        <ThemeSwitch />
        <LangSwitch />
        <button className="btn small" type="button" disabled={leaving} onClick={logout}>
          {t.change}
        </button>
      </div>
    </header>
  );
}

export function BusinessDashboard() {
  const t = useDemoT();
  const report = useLiveResource(demoApi.partner);
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const logout = () => {
    setLeaving(true);
    setLogoutError(false);
    void demoApi.logout().then(
      () => {
        setTravellerEntered(false);
        window.location.hash = '/access';
      },
      () => {
        setLeaving(false);
        setLogoutError(true);
      },
    );
  };
  return (
    <>
      <BusinessHeader logout={logout} leaving={leaving} />
      <main id="main" className="biz" tabIndex={-1}>
        <div className="biz-intro">
          <div>
            <p className="biz-tag">{t.companyTag}</p>
            <h1>{t.company}</h1>
            <p className="biz-lead">{t.companyLead}</p>
          </div>
          <Refresh {...report} />
        </div>
        {logoutError && <p role="alert">{t.failed}</p>}
        {report.data === null && report.error && (
          <p>
            <a className="link" href="#/access">
              {t.access}
            </a>
          </p>
        )}
        {report.data !== null && (
          <>
            <Sales report={report.data} />
            <BusinessCatalog />
          </>
        )}
      </main>
    </>
  );
}
