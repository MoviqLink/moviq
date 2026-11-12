import type { TicketAutopay } from '@moviq/contracts';
import { localeOf, useLang } from '../../shared/i18n/lang';
import { useAgentsT } from './texts';
import type { PayPal } from './usePayPal';

export const PERMISSIONS_ID = 'sara-permissions';

function PayPalState({ paypal, state }: { paypal: PayPal; state: TicketAutopay }) {
  const t = useAgentsT();
  const lang = useLang();
  if (!state.enabled) return <p>{t.noBuy}</p>;
  if (!state.available) return <p>{t.paypalMissing}</p>;
  if (state.testBuyer) return <p className="agents-paypal-on">{t.paypalTestBuyer}</p>;
  if (state.connected) {
    const since =
      state.connectedAt === null
        ? ''
        : ` · ${new Date(state.connectedAt).toLocaleDateString(localeOf(lang))}`;
    return (
      <div className="agents-paypal-row">
        <p className="agents-paypal-on">
          {t.paypalOn}
          {since}
        </p>
        <button
          type="button"
          disabled={paypal.busy}
          onClick={() => {
            void paypal.disconnect();
          }}
        >
          {t.disconnect}
        </button>
      </div>
    );
  }
  return (
    <div className="agents-paypal-row">
      <p>{t.approveOnce}</p>
      <button
        type="button"
        className="agents-paypal"
        disabled={paypal.busy}
        onClick={() => {
          void paypal.connect();
        }}
      >
        {paypal.busy ? t.connecting : t.connect}
      </button>
    </div>
  );
}

/** What the traveller lets Sara do: today, buying tickets with PayPal. */
export function Permissions({ paypal }: { paypal: PayPal }) {
  const t = useAgentsT();
  const { state } = paypal;
  return (
    <section className="agents-permissions" id={PERMISSIONS_ID} tabIndex={-1}>
      <h2>{t.permissions}</h2>
      {paypal.returned !== null && (
        <p
          role={paypal.returned === 'failed' ? 'alert' : 'status'}
          className={`agents-returned ${paypal.returned}`}
        >
          {paypal.returned === 'connected' ? t.returnedOk : t.returnedFailed}
        </p>
      )}
      <label className="agents-check">
        <input
          type="checkbox"
          checked={state?.enabled ?? true}
          disabled={state === null || paypal.busy}
          onChange={(event) => {
            void paypal.setEnabled(event.target.checked);
          }}
        />
        <span>{t.allowBuy}</span>
      </label>
      <div className="agents-check-detail">
        {state === null && !paypal.failed && <p>{t.paypalChecking}</p>}
        {state !== null && <PayPalState paypal={paypal} state={state} />}
        {paypal.failed && (
          <p role="alert">
            {t.paypalError}{' '}
            <button type="button" onClick={paypal.retry}>
              {t.refresh}
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
