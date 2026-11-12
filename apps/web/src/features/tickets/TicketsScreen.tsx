import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../shared/api/errors';
import { TopBar } from '../../shared/ui/TopBar';
import { travellerHref } from '../../shared/routing/hrefs';
import { useHomeT } from '../home/texts';
import { TicketCatalog as TicketCatalogView } from './TicketCatalog';
import { ticketsApi } from './api';
import { useTicketsT } from './texts';
import { TicketWallet as TicketWalletView } from './TicketWallet';
import './tickets.css';

interface ReadState<T> {
  readonly data: T | null;
  readonly error: boolean;
  readonly loading: boolean;
  readonly retry: () => void;
}

interface Stored<T> {
  readonly data: T | null;
  readonly error: boolean;
  readonly settledAttempt: number;
}

function useTicketRead<T>(load: (signal: AbortSignal) => Promise<T>): ReadState<T> {
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<Stored<T>>({ data: null, error: false, settledAttempt: -1 });
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setStored({ data, error: false, settledAttempt: attempt });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
        setStored((previous) => ({ ...previous, error: true, settledAttempt: attempt }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt, load]);
  return {
    data: stored.data,
    error: stored.error && stored.settledAttempt === attempt,
    loading: stored.settledAttempt !== attempt,
    retry: () => {
      setAttempt((value) => value + 1);
    },
  };
}

function TicketPage({
  loadingText,
  loading,
  error,
  retry,
  children,
  embedded,
}: {
  readonly loadingText: string;
  readonly loading: boolean;
  readonly error: boolean;
  readonly retry: () => void;
  readonly children: ReactNode;
  readonly embedded?: boolean;
}) {
  const t = useTicketsT();
  const home = useHomeT();
  return (
    <>
      {!embedded && <TopBar variant="solid" homeLabel={home.home} skipLabel={t.skip} />}
      <main id="main" className="page tickets-page" tabIndex={-1}>
        <header className="tickets-hero">
          <p className="ticket-eyebrow">{t.demo}</p>
          <h1>{embedded ? t.wallet : t.title}</h1>
          <p className="ticket-hero-lead">{embedded ? t.walletLead : t.lead}</p>
        </header>
        {embedded && (loading || error) && (
          <a className="btn small" href={travellerHref.tickets}>
            {t.back}
          </a>
        )}
        {loading && (
          <p role="status" className="ticket-loading">
            {loadingText}
          </p>
        )}
        {error && (
          <div className="ticket-error" role="alert">
            <p>{t.failed}</p>
            <button
              className="btn small"
              type="button"
              onClick={() => {
                retry();
              }}
            >
              {t.retry}
            </button>
          </div>
        )}
        {children}
      </main>
    </>
  );
}

function CatalogRoute() {
  const t = useTicketsT();
  const read = useTicketRead(ticketsApi.catalog);
  return (
    <TicketPage
      loadingText={t.loading}
      loading={read.loading && read.data === null}
      error={read.error}
      retry={read.retry}
    >
      {!read.error && read.data !== null && <TicketCatalogView data={read.data} />}
    </TicketPage>
  );
}

function WalletRoute() {
  const t = useTicketsT();
  const read = useTicketRead(ticketsApi.wallet);
  return (
    <TicketPage
      embedded
      loadingText={t.loadingWallet}
      loading={read.loading && read.data === null}
      error={read.error}
      retry={read.retry}
    >
      {!read.error && read.data !== null && <TicketWalletView data={read.data} />}
    </TicketPage>
  );
}

/** Fare catalog at `#/tickets`; confirmed demo receipts at `#/tickets/wallet`. */
export function TicketsScreen({ wallet }: { readonly wallet: boolean }) {
  return wallet ? <WalletRoute key="wallet" /> : <CatalogRoute key="catalog" />;
}
