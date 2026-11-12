import type { ColDef } from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { useMemo } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang, type Lang } from '../../shared/i18n/lang';
import { travellerHref } from '../../shared/routing/hrefs';
import { DataGrid, NUMERIC } from '../../shared/ui/DataGrid';
import { TripFailed, TripRow } from '../home/trips/TripRow';
import { useTrips } from '../home/trips/useTrips';
import { clock, fare, LineBadges, SampleNotice, ScreenHead } from './parts';
import { SAMPLE_TRIPS, sampleDate, sampleStats, type SampleLeg } from './sample';
import '../../shared/journey/journey.css';
import '../home/trips/trips.css';
import './triplog.css';

interface HistoryRow {
  readonly id: string;
  readonly when: number;
  readonly route: string;
  readonly legs: readonly SampleLeg[];
  readonly planned: number;
  readonly actual: number;
  /** Minutes late, or null when the trip counts as on time. */
  readonly late: number | null;
  readonly sara: string;
  readonly tickets: number;
  readonly fareMinor: number;
}

function historyRows(lang: Lang): HistoryRow[] {
  return SAMPLE_TRIPS.filter((item) => item.dayOffset < 0).map((item) => ({
    id: item.id,
    when: sampleDate(item).getTime(),
    route: `${item.from} → ${item.to}`,
    legs: item.legs,
    planned: item.plannedMinutes,
    actual: item.actualMinutes,
    // The same rule as the figures above, so the grid and the cards always agree.
    late: sampleStats([item]).onTime === 1 ? null : item.actualMinutes - item.plannedMinutes,
    sara: item.rerouted?.[lang] ?? '—',
    tickets: item.tickets,
    fareMinor: item.fareMinor,
  }));
}

function LinesCell({ data }: CustomCellRendererProps<HistoryRow>) {
  return data === undefined ? null : <LineBadges legs={data.legs} />;
}

function historyColumns(lang: Lang, locale: string): ColDef<HistoryRow>[] {
  const es = lang === 'es';
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  return [
    {
      colId: 'when',
      headerName: es ? 'Fecha y hora' : 'Date and time',
      field: 'when',
      sort: 'desc',
      width: 150,
      cellClass: 'mono',
      valueFormatter: ({ value }: { value: number | null | undefined }) =>
        value === null || value === undefined
          ? ''
          : `${day.format(value)} · ${clock(new Date(value), locale)}`,
    },
    {
      colId: 'route',
      headerName: es ? 'Trayecto' : 'Route',
      field: 'route',
      minWidth: 280,
      flex: 1,
    },
    {
      colId: 'lines',
      headerName: es ? 'Líneas' : 'Lines',
      cellRenderer: LinesCell,
      sortable: false,
      width: 150,
    },
    { ...NUMERIC, colId: 'planned', headerName: es ? 'Previsto' : 'Planned', field: 'planned' },
    { ...NUMERIC, colId: 'actual', headerName: es ? 'Real' : 'Actual', field: 'actual' },
    {
      colId: 'late',
      headerName: es ? 'Estado' : 'Status',
      field: 'late',
      width: 120,
      cellClass: ({ value }: { value: number | null | undefined }) =>
        value === null || value === undefined ? 'triplog-ok' : 'triplog-late',
      valueFormatter: ({ value }: { value: number | null | undefined }) =>
        value === null || value === undefined
          ? es
            ? 'A tiempo'
            : 'On time'
          : `+${String(value)} min`,
    },
    {
      colId: 'sara',
      headerName: es ? 'Qué hizo Sara' : 'What Sara did',
      field: 'sara',
      width: 360,
    },
    { ...NUMERIC, colId: 'tickets', headerName: es ? 'Billetes' : 'Tickets', field: 'tickets' },
    {
      ...NUMERIC,
      colId: 'fare',
      headerName: es ? 'Importe' : 'Amount',
      field: 'fareMinor',
      valueFormatter: ({ value }: { value: number | null | undefined }) =>
        value === null || value === undefined ? '' : fare(value, locale),
    },
  ];
}

function Figures({ lang, locale }: { lang: Lang; locale: string }) {
  const es = lang === 'es';
  const stats = sampleStats();
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const cards = [
    {
      label: es ? 'Viajes' : 'Trips',
      value: String(stats.trips),
      detail: es
        ? `${hours.format(stats.minutesTravelled / 60)} h en transporte`
        : `${hours.format(stats.minutesTravelled / 60)} h on transit`,
    },
    {
      label: es ? 'A tiempo' : 'On time',
      value: `${String(stats.onTimePercent)} %`,
      detail: es
        ? `${String(stats.onTime)} de ${String(stats.trips)}`
        : `${String(stats.onTime)} of ${String(stats.trips)}`,
    },
    {
      label: es ? 'Sara intervino' : 'Sara stepped in',
      value: String(stats.rerouted),
      detail: es ? 'viajes con un cambio a tiempo' : 'trips changed in time',
    },
    {
      label: es ? 'Billetes' : 'Tickets',
      value: String(stats.tickets),
      detail: fare(stats.spentMinor, locale),
    },
  ];
  return (
    <section className="triplog-card" aria-label={es ? 'Cifras' : 'Figures'}>
      <ul className="triplog-figures">
        {cards.map((card) => (
          <li key={card.label} className="triplog-figure">
            <span className="triplog-kicker">{card.label}</span>
            <strong className="num">{card.value}</strong>
            <span className="triplog-figure-detail">{card.detail}</span>
          </li>
        ))}
      </ul>
      <SampleNotice lang={lang} />
    </section>
  );
}

function LiveTrips({ es }: { es: boolean }) {
  const { trips, retry } = useTrips();
  const shown = trips.filter((trip) => trip.state !== 'loading');
  return (
    <section className="triplog-card" aria-labelledby="triplog-live">
      <h2 id="triplog-live">{es ? 'Viajes en directo' : 'Live trips'}</h2>
      <p className="triplog-wait" role="status">
        {shown.length < trips.length ? (es ? 'Cargando…' : 'Loading…') : ''}
      </p>
      {trips.length === 0 && (
        <p className="triplog-empty">
          {es ? 'Todavía no hay viajes en directo.' : 'No live trips yet.'}{' '}
          <a href={travellerHref.agents}>{es ? 'Habla con Sara' : 'Talk to Sara'}</a>
        </p>
      )}
      {shown.length > 0 && (
        <ol className="trips-list">
          {shown.map((trip) =>
            trip.state === 'ready' ? (
              <TripRow key={trip.id} journey={trip.journey} />
            ) : (
              <TripFailed key={trip.id} onRetry={retry} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

/** My trips: the figures of the month, the trips live now and the history Sara followed. */
export function MyTripsScreen() {
  const lang = useLang();
  const locale = useLocale();
  const es = lang === 'es';
  const rows = useMemo(() => historyRows(lang), [lang]);
  const columns = useMemo(() => historyColumns(lang, locale), [lang, locale]);
  return (
    <main id="main" className="page triplog" tabIndex={-1}>
      <ScreenHead
        kicker={es ? 'MOVIQ / MIS VIAJES' : 'MOVIQ / MY TRIPS'}
        title={es ? 'Mis viajes' : 'My trips'}
        lead={
          es
            ? 'Sara planifica, vigila y compra los billetes de cada viaje.'
            : 'Sara plans, watches and buys the tickets for every trip.'
        }
      />
      <Figures lang={lang} locale={locale} />
      <LiveTrips es={es} />
      <section className="triplog-card" aria-labelledby="triplog-history">
        <h2 id="triplog-history">{es ? 'Historial de viajes' : 'Trip history'}</h2>
        <SampleNotice lang={lang} />
        <DataGrid<HistoryRow>
          rows={rows}
          columns={columns}
          label={es ? 'Historial de viajes' : 'Trip history'}
          empty={es ? 'Todavía no hay viajes.' : 'No trips yet.'}
          getRowId={({ data }) => data.id}
        />
      </section>
    </main>
  );
}
