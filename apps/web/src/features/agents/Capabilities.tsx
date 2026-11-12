import { PERMISSIONS_ID } from './Permissions';
import { useAgentsT } from './texts';
import type { PayPal } from './usePayPal';

function PayPalNote({ paypal }: { paypal: PayPal }) {
  const t = useAgentsT();
  const { state } = paypal;
  if (state === null && !paypal.failed) {
    return <p className="agents-step-note">{t.paypalChecking}</p>;
  }
  if (state !== null && state.enabled && state.connected) {
    return <p className="agents-step-note agents-step-on">{t.paypalOn}</p>;
  }
  return (
    <button
      type="button"
      className="agents-step-link"
      onClick={() => {
        document.getElementById(PERMISSIONS_ID)?.focus();
      }}
    >
      {t.paypalSetup}
    </button>
  );
}

/** Sara's three jobs, drawn as stops on one route line: plan, watch, buy. */
export function Capabilities({ paypal }: { paypal: PayPal }) {
  const t = useAgentsT();
  return (
    <section className="agents-steps" aria-label={t.abilities}>
      <ol>
        <li>
          <strong>{t.plans}</strong>
          <p className="agents-step-note">{t.plansText}</p>
        </li>
        <li>
          <strong>{t.watchesLive}</strong>
          <p className="agents-step-note">{t.watchesLiveText}</p>
        </li>
        <li>
          <strong>{t.buys}</strong>
          <PayPalNote paypal={paypal} />
        </li>
      </ol>
    </section>
  );
}
