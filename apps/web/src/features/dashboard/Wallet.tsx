import type { TripWallet, WalletMovement } from '@moviq/contracts';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import type { WalletResource } from './Glance';

/** How many movements the card lists; the wallet section has them all. */
const MOVEMENTS_SHOWN = 3;

/** The trip wallet at a glance: what is left, what was added and spent, the latest movements. */
export function WalletCard({ wallet }: { readonly wallet: WalletResource }) {
  const es = useLang() === 'es';
  return (
    <section className="dash-wallet" aria-labelledby="dash-wallet-title">
      <div className="dash-section-head">
        <div>
          <p className="dash-kicker">{es ? 'BILLETERA · PAYPAL' : 'WALLET · PAYPAL'}</p>
          <h2 id="dash-wallet-title">{es ? 'Tu billetera de viaje' : 'Your trip wallet'}</h2>
        </div>
      </div>
      {wallet.data === null ? (
        <p className="dash-empty" role="status">
          {wallet.loading
            ? es
              ? 'Consultando tu billetera…'
              : 'Checking your wallet…'
            : es
              ? 'No disponible ahora mismo. Vuelve a mirarlo en un momento.'
              : 'Unavailable right now. Check again in a moment.'}
        </p>
      ) : (
        <Figures wallet={wallet.data} />
      )}
      <div className="wallet-foot">
        <a className="wallet-cta" href="#/dashboard?section=wallet">
          {es ? 'Añadir dinero con PayPal' : 'Add funds with PayPal'}{' '}
          <span aria-hidden="true">→</span>
        </a>
        <p className="wallet-sandbox">
          {es ? 'PayPal Sandbox: no se mueve dinero real.' : 'PayPal Sandbox: no real money moves.'}
        </p>
      </div>
    </section>
  );
}

function Figures({ wallet }: { readonly wallet: TripWallet }) {
  const es = useLang() === 'es';
  const locale = useLocale();
  const added = wallet.added.amountMinor;
  const spent = Math.min(wallet.spent.amountMinor, added);
  return (
    <>
      <p className="wallet-balance">
        <span>{es ? 'Disponible para gastar' : 'Available to spend'}</span>
        <strong>{formatMoney(wallet.balance, locale)}</strong>
      </p>
      {added > 0 && (
        <span className="wallet-split" aria-hidden="true">
          <span data-part="spent" style={{ flexGrow: spent }} />
          <span data-part="left" style={{ flexGrow: added - spent }} />
        </span>
      )}
      <dl className="wallet-numbers">
        <div data-part="added">
          <dt>{es ? 'Añadido' : 'Added'}</dt>
          <dd>{formatMoney(wallet.added, locale)}</dd>
        </div>
        <div data-part="spent">
          <dt>{es ? 'Gastado' : 'Spent'}</dt>
          <dd>{formatMoney(wallet.spent, locale)}</dd>
        </div>
      </dl>
      <div className="wallet-movements">
        <h3>{es ? 'Últimos movimientos' : 'Latest movements'}</h3>
        {wallet.movements.length === 0 ? (
          <p className="dash-detail">{es ? 'Aún no hay movimientos.' : 'No movements yet.'}</p>
        ) : (
          <ul>
            {wallet.movements.slice(0, MOVEMENTS_SHOWN).map((movement) => (
              <Movement key={movement.id} movement={movement} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Movement({ movement }: { readonly movement: WalletMovement }) {
  const locale = useLocale();
  const amount = formatMoney(
    { currency: movement.currency, amountMinor: Math.abs(movement.amountMinor) },
    locale,
  );
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
    new Date(movement.at),
  );
  return (
    <li data-sign={movement.amountMinor < 0 ? 'out' : 'in'}>
      <span>
        <span className="wallet-line-label">{movement.label}</span>
        <time dateTime={movement.at}>{day}</time>
      </span>
      <strong>
        {movement.amountMinor < 0 ? '−' : '+'}
        {amount}
      </strong>
    </li>
  );
}
