import {
  WALLET_TOP_UP_MAX_MINOR,
  WALLET_TOP_UP_MIN_MINOR,
  type TripWallet,
  type WalletTopUp,
} from '@moviq/contracts';
import { useCallback, useEffect, useId, useState } from 'react';

import { useLocale } from '../../shared/i18n';
import { formatMoney } from '../../shared/journey/money';
import { SandboxHelp } from '../tickets/SandboxHelp';
import { useCheckout, type CheckoutState } from '../trip/payment/useCheckout';
import { walletApi } from './api';
import { TopUpPayment } from './TopUpPayment';
import type { Words } from './words';

const PRESETS = [1000, 2500, 5000, 10000] as const;
export type Choice = (typeof PRESETS)[number] | 'other';

const MIN_DOLLARS = WALLET_TOP_UP_MIN_MINOR / 100;
const MAX_DOLLARS = WALLET_TOP_UP_MAX_MINOR / 100;

/** The amount in cents for a choice, or null while "Other" holds no valid whole amount. */
export function amountFor(choice: Choice, other: string): number | null {
  if (choice !== 'other') return choice;
  if (!/^\d{1,3}$/.test(other.trim())) return null;
  const dollars = Number(other.trim());
  return dollars >= MIN_DOLLARS && dollars <= MAX_DOLLARS ? dollars * 100 : null;
}

/**
 * Records a top-up for the chosen amount, so PayPal is offered a server-priced purpose. Typing in
 * "Other" settles first, so a keystroke is not a top-up; `again` records a fresh one.
 */
function usePreparedTopUp(amountMinor: number | null, enabled: boolean) {
  const [round, setRound] = useState(0);
  const key = enabled && amountMinor !== null ? `${String(amountMinor)}:${String(round)}` : null;
  const [result, setResult] = useState<{
    readonly key: string;
    readonly topUp: WalletTopUp | null;
  } | null>(null);
  useEffect(() => {
    if (key === null || amountMinor === null) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      walletApi.topUp(amountMinor).then(
        (topUp) => {
          if (!cancelled) setResult({ key, topUp });
        },
        () => {
          if (!cancelled) setResult({ key, topUp: null });
        },
      );
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, amountMinor]);
  const again = useCallback(() => {
    setRound((value) => value + 1);
  }, []);
  const current = result !== null && result.key === key ? result : null;
  return {
    topUp: current?.topUp ?? null,
    failed: current !== null && current.topUp === null,
    again,
  };
}

/** Choosing an amount and paying it with PayPal into the trip wallet. */
export function AddFunds({
  w,
  wallet,
  onAdded,
}: {
  readonly w: Words;
  readonly wallet: TripWallet | null;
  readonly onAdded: () => void;
}) {
  const locale = useLocale();
  const [choice, setChoice] = useState<Choice>(2500);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [paypalAttempt, setPaypalAttempt] = useState(0);
  const checkout = useCheckout(locale, paypalAttempt);
  const amountMinor = amountFor(choice, other);
  const prepared = usePreparedTopUp(amountMinor, wallet?.available === true);
  return (
    <section className="wal-card wal-add" aria-labelledby="wal-add-title">
      <h2 id="wal-add-title">{w.addTitle}</h2>
      <p className="wal-lead">{w.addLead}</p>
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
      <SandboxHelp />
      <PayArea
        w={w}
        wallet={wallet}
        ready={amountMinor !== null}
        topUp={prepared.topUp}
        prepareFailed={prepared.failed}
        checkout={checkout}
        onRetryPrepare={prepared.again}
        onRetryPayPal={() => {
          setPaypalAttempt((value) => value + 1);
        }}
        onBusyChange={setBusy}
        onAdded={onAdded}
        onAddMore={prepared.again}
      />
    </section>
  );
}

export function AmountPicker({
  w,
  choice,
  other,
  invalid,
  disabled,
  onChoose,
  onOther,
}: {
  readonly w: Words;
  readonly choice: Choice;
  readonly other: string;
  readonly invalid: boolean;
  readonly disabled: boolean;
  readonly onChoose: (choice: Choice) => void;
  readonly onOther: (value: string) => void;
}) {
  const locale = useLocale();
  const otherId = useId();
  const choices: readonly Choice[] = [...PRESETS, 'other'];
  return (
    <>
      <div className="wal-pills" role="radiogroup" aria-label={w.amounts}>
        {choices.map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={choice === item}
            className="wal-pill"
            disabled={disabled}
            onClick={() => {
              onChoose(item);
            }}
          >
            {item === 'other'
              ? w.other
              : formatMoney({ amountMinor: item, currency: 'USD' }, locale)}
          </button>
        ))}
      </div>
      {choice === 'other' && (
        <div className="wal-other">
          <label htmlFor={otherId}>{w.otherLabel}</label>
          <div className="wal-other-field">
            <span aria-hidden="true">$</span>
            <input
              id={otherId}
              type="number"
              inputMode="numeric"
              min={MIN_DOLLARS}
              max={MAX_DOLLARS}
              step={1}
              value={other}
              disabled={disabled}
              aria-invalid={invalid}
              onChange={(event) => {
                onOther(event.target.value);
              }}
            />
          </div>
          {invalid && <p className="wal-detail">{w.outOfRange}</p>}
        </div>
      )}
    </>
  );
}

function PayArea({
  w,
  wallet,
  ready,
  topUp,
  prepareFailed,
  checkout,
  onRetryPrepare,
  onRetryPayPal,
  onBusyChange,
  onAdded,
  onAddMore,
}: {
  readonly w: Words;
  readonly wallet: TripWallet | null;
  readonly ready: boolean;
  readonly topUp: WalletTopUp | null;
  readonly prepareFailed: boolean;
  readonly checkout: CheckoutState;
  readonly onRetryPrepare: () => void;
  readonly onRetryPayPal: () => void;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onAdded: () => void;
  readonly onAddMore: () => void;
}) {
  if (wallet === null) return <p className="wal-detail">{w.waitWallet}</p>;
  if (!wallet.available) return <p className="wal-detail">{w.notSetUp}</p>;
  if (checkout.status === 'loading') return <p role="status">{w.loadingPayPal}</p>;
  if (checkout.status === 'unavailable' || checkout.status === 'not-eligible') {
    return <p className="wal-detail">{w.payPalOff}</p>;
  }
  if (checkout.status === 'failed') {
    return <Retry message={w.payPalFailed} action={w.retryPayPal} onRetry={onRetryPayPal} />;
  }
  if (!checkout.sandbox) return <p className="wal-detail">{w.sandboxOnly}</p>;
  if (!ready) return null;
  if (prepareFailed)
    return <Retry message={w.prepareFailed} action={w.retry} onRetry={onRetryPrepare} />;
  if (topUp === null) return <p role="status">{w.preparing}</p>;
  return (
    <TopUpPayment
      key={topUp.id}
      topUp={topUp}
      checkout={checkout.checkout}
      onBusyChange={onBusyChange}
      onAdded={onAdded}
      onAddMore={onAddMore}
    />
  );
}

function Retry({
  message,
  action,
  onRetry,
}: {
  readonly message: string;
  readonly action: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="wal-retry">
      <p role="alert">{message}</p>
      <button className="btn small" type="button" onClick={onRetry}>
        {action}
      </button>
    </div>
  );
}
