import type { TicketWallet } from '@moviq/contracts';
import { lazy, Suspense } from 'react';

import { useLang } from '../../shared/i18n/lang';
import { AskSara } from '../home/AskSara';
import { useLiveResource } from '../demo/useLiveResource';
import { ticketsApi } from '../tickets/api';
import { walletApi } from '../wallet/api';
import { Glance } from './Glance';
import { SampleTrips } from './SampleTrips';
import { WalletCard } from './Wallet';
import '../home/home.css';
import './dashboard.css';

const RecentTickets = lazy(() => import('./RecentTickets'));

function Intro() {
  const es = useLang() === 'es';
  return (
    <header className="dash-intro">
      <div>
        <p className="dash-kicker">MOVIQ / {es ? 'TU PANEL' : 'YOUR DASHBOARD'}</p>
        <h1>{es ? 'Tu asistente urbano con IA' : 'Your AI urban assistant'}</h1>
        <p>
          {es
            ? 'Conecta PayPal una vez y Sara compra los billetes que necesita cada viaje.'
            : 'Connect PayPal once and Sara buys the tickets each trip needs.'}
        </p>
      </div>
    </header>
  );
}
function Sara({ onAsk }: { readonly onAsk: (message: string) => void }) {
  const es = useLang() === 'es';
  return (
    <section className="dash-sara" aria-labelledby="dash-sara-title">
      <div className="dash-section-head">
        <div>
          <p className="dash-kicker">SARA / AI</p>
          <h2 id="dash-sara-title">{es ? '¿Adónde vamos?' : 'Where are we going?'}</h2>
        </div>
        <span className="dash-route-mark" aria-hidden="true" />
      </div>
      <AskSara onAsk={onAsk} />
    </section>
  );
}
function Tickets({
  wallet,
}: {
  readonly wallet: { data: TicketWallet | null; loading: boolean; error: boolean };
}) {
  const es = useLang() === 'es';
  return (
    <section className="dash-tickets" aria-labelledby="dash-tickets-title">
      <div className="dash-section-head">
        <div>
          <p className="dash-kicker">{es ? 'COMPRADOS POR SARA' : 'BOUGHT BY SARA'}</p>
          <h2 id="dash-tickets-title">{es ? 'Mis billetes' : 'My tickets'}</h2>
        </div>
        <a className="dash-head-link" href="#/dashboard?section=purchases">
          {es ? 'Ver todos' : 'View all'} <span aria-hidden="true">→</span>
        </a>
      </div>
      {wallet.data === null ? (
        <p className="dash-empty">
          {wallet.loading
            ? es
              ? 'Consultando tus billetes…'
              : 'Checking your tickets…'
            : es
              ? 'Tus billetes no están disponibles ahora mismo.'
              : 'Your tickets are unavailable right now.'}
        </p>
      ) : (
        <Suspense fallback={<p className="dash-empty">{es ? 'Cargando…' : 'Loading…'}</p>}>
          <RecentTickets items={wallet.data.items} />
        </Suspense>
      )}
      {wallet.error && wallet.data !== null && (
        <p className="dash-detail" role="alert">
          {es ? 'Puede estar desactualizado.' : 'May be out of date.'}
        </p>
      )}
      <a className="dash-link" href="#/dashboard?section=payments">
        {es ? 'Toda la actividad' : 'All activity'} <span aria-hidden="true">→</span>
      </a>
    </section>
  );
}
export function DashboardOverview({ onAsk }: { readonly onAsk: (message: string) => void }) {
  const tickets = useLiveResource(ticketsApi.wallet);
  const wallet = useLiveResource(walletApi.wallet);
  return (
    <main id="main" className="traveller-dashboard" tabIndex={-1}>
      <Intro />
      <div className="dash-grid">
        <Sara onAsk={onAsk} />
        <div className="dash-glance">
          <Glance wallet={wallet} />
          <WalletCard wallet={wallet} />
        </div>
        <SampleTrips />
        <Tickets wallet={tickets} />
      </div>
    </main>
  );
}
