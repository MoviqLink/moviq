import { useState } from 'react';

import { useLocale } from '../../shared/i18n';
import { useLang } from '../../shared/i18n/lang';
import { formatMoney } from '../../shared/journey/money';
import { AmountPicker, amountFor, type Choice } from './AddFunds';
import { walletApi } from './api';
import type { Words } from './words';

const WORDS = {
  en: {
    connected: 'PayPal Sandbox is connected: no sign-in needed.',
    add: (amount: string) => `Add ${amount} with PayPal`,
    adding: 'PayPal is confirming the payment…',
    added: (amount: string) => `${amount} added to your trip wallet.`,
    failed: 'PayPal did not confirm this top-up. Nothing was added; try again.',
  },
  es: {
    connected: 'PayPal Sandbox está conectado: no hace falta iniciar sesión.',
    add: (amount: string) => `Añadir ${amount} con PayPal`,
    adding: 'PayPal está confirmando el pago…',
    added: (amount: string) => `${amount} añadidos a tu billetera de viaje.`,
    failed: 'PayPal no ha confirmado esta recarga. No se ha añadido nada; inténtalo de nuevo.',
  },
} as const;

type Result = { readonly kind: 'added'; readonly amount: string } | { readonly kind: 'failed' };

/**
 * Adding funds with the PayPal already connected: one press charges the agreement on the server
 * and the balance grows once PayPal confirms the capture. No PayPal window opens.
 */
export function QuickAddFunds({
  w,
  onWallet,
}: {
  readonly w: Words;
  /** Called once PayPal confirmed the top-up, to read the wallet again. */
  readonly onWallet: () => void;
}) {
  const t = WORDS[useLang()];
  const locale = useLocale();
  const [choice, setChoice] = useState<Choice>(2500);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const amountMinor = amountFor(choice, other);
  const amount =
    amountMinor === null ? null : formatMoney({ amountMinor, currency: 'USD' }, locale);
  const add = () => {
    if (amountMinor === null || amount === null) return;
    setBusy(true);
    setResult(null);
    walletApi.addWithConnectedPayPal(amountMinor).then(
      () => {
        onWallet();
        setResult({ kind: 'added', amount });
        setBusy(false);
      },
      () => {
        setResult({ kind: 'failed' });
        setBusy(false);
      },
    );
  };
  return (
    <section className="wal-card wal-add" aria-labelledby="wal-add-title">
      <h2 id="wal-add-title">{w.addTitle}</h2>
      <p className="wal-lead">{t.connected}</p>
      <AmountPicker
        w={w}
        choice={choice}
        other={other}
        invalid={choice === 'other' && other !== '' && amountMinor === null}
        disabled={busy}
        onChoose={setChoice}
        onOther={setOther}
      />
      <p className="wal-note">{w.note}</p>
      <div className="wal-pay">
        <button
          className="wal-quick"
          type="button"
          disabled={busy || amount === null}
          onClick={add}
        >
          {busy ? t.adding : amount === null ? w.addTitle : t.add(amount)}
        </button>
        {result !== null && (
          <p
            className={`wal-status ${result.kind === 'added' ? 'captured' : 'failed'}`}
            role={result.kind === 'added' ? 'status' : 'alert'}
          >
            {result.kind === 'added' ? t.added(result.amount) : t.failed}
          </p>
        )}
      </div>
    </section>
  );
}
