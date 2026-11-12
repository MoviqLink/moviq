import type { TripWallet } from '@moviq/contracts';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { useLiveResource } from '../demo/useLiveResource';
import { ticketsApi } from '../tickets/api';
import { AddFunds } from './AddFunds';
import { walletApi } from './api';
import { QuickAddFunds } from './QuickAddFunds';
import { WORDS, type Words } from './words';
import './wallet.css';

/** The trip wallet: its balance and totals, and adding money with PayPal. */
export function WalletScreen() {
  const w = WORDS[useLang()];
  const wallet = useLiveResource(walletApi.wallet);
  const autopay = useLiveResource(ticketsApi.autopay);
  return (
    <main id="main" className="page wal-page" tabIndex={-1}>
      <div className="wal-layout">
        <BalanceCard w={w} wallet={wallet} />
        {autopay.data?.connected === true ? (
          <QuickAddFunds w={w} onWallet={wallet.refresh} />
        ) : (
          <AddFunds w={w} wallet={wallet.data} onAdded={wallet.refresh} />
        )}
      </div>
      {wallet.data !== null && <Movements w={w} wallet={wallet.data} />}
    </main>
  );
}

function BalanceCard({
  w,
  wallet,
}: {
  readonly w: Words;
  readonly wallet: {
    data: TripWallet | null;
    loading: boolean;
    error: boolean;
    refresh: () => void;
  };
}) {
  const locale = useLocale();
  const { data } = wallet;
  return (
    <section className="wal-card wal-balance" aria-labelledby="wal-title">
      <p className="wal-kicker">{w.kicker}</p>
      <h1 id="wal-title">{w.title}</h1>
      <p className="wal-kicker wal-available">{w.available}</p>
      {data === null ? (
        <div className="wal-empty">
          <p role={wallet.loading ? 'status' : 'alert'}>
            {wallet.loading ? w.loading : w.unavailable}
          </p>
          {!wallet.loading && (
            <button className="btn small" type="button" onClick={wallet.refresh}>
              {w.retry}
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="wal-amount">{formatMoney(data.balance, locale)}</p>
          <p className="wal-lead">{w.lead}</p>
          <dl className="wal-totals">
            <div>
              <dt>{w.addedWith}</dt>
              <dd>{formatMoney(data.added, locale)}</dd>
            </div>
            <div>
              <dt>{w.spent}</dt>
              <dd>{formatMoney(data.spent, locale)}</dd>
            </div>
          </dl>
          {wallet.error && (
            <p className="wal-detail" role="alert">
              {w.stale}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Movements({ w, wallet }: { readonly w: Words; readonly wallet: TripWallet }) {
  const locale = useLocale();
  const latest = wallet.movements.slice(0, 6);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <section className="wal-card wal-movements" aria-labelledby="wal-movements-title">
      <h2 id="wal-movements-title">{w.recent}</h2>
      {latest.length === 0 ? (
        <p className="wal-detail">{w.noMovements}</p>
      ) : (
        <ul>
          {latest.map((movement) => (
            <li key={movement.id}>
              <span className="wal-kind">{movement.kind === 'top-up' ? w.topUp : w.ticket}</span>
              <span className="wal-label">
                {movement.kind === 'top-up' ? w.addedWith : movement.label}
              </span>
              <time dateTime={movement.at}>{when.format(new Date(movement.at))}</time>
              <span className={`wal-sum ${movement.amountMinor < 0 ? 'out' : 'in'}`}>
                {movement.amountMinor > 0 ? '+' : ''}
                {formatMoney(
                  { amountMinor: movement.amountMinor, currency: movement.currency },
                  locale,
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
