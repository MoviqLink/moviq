import type { OrderView } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';

import { useLocale } from '../../../shared/i18n';
import { useLang } from '../../../shared/i18n/lang';
import type { Checkout } from '../../trip/payment/flow';
import { PayPalButton } from '../../trip/payment/PayPalButton';
import { useCheckout } from '../../trip/payment/useCheckout';
import { rewardsApi } from '../api';
import { serverWords } from '../model/server-words';
import { useRewardsT, type RewardsDict } from '../texts';
import { createHoldFlow, isHolding, type HoldFlow, type HoldState } from './flow';

function stepText(state: HoldState, t: RewardsDict['hold'], lang: 'en' | 'es'): string | null {
  switch (state.step) {
    case 'idle':
    case 'reserved':
      return null;
    case 'creating':
      return t.creating;
    case 'approving':
      return t.approving;
    case 'confirming':
      return t.confirming;
    case 'cancelled':
      return t.cancelled;
    case 'unconfirmed':
      return t.unconfirmed;
    case 'failed':
      if (state.why !== 'gone') return t[state.why === 'other' ? 'failed' : state.why];
      return `${serverWords(state.message, lang) ?? t.gone} ${t.goneNext}`;
  }
}

interface Props {
  readonly offerId: string;
  readonly onReserved: (order: OrderView) => void;
}

type StepsProps = Props & { readonly checkout: Checkout };

/** The official button, locked while a step is in flight, and each step in words. */
function HoldSteps({ checkout, offerId, onReserved }: StepsProps) {
  const t = useRewardsT().hold;
  const language = useLang();
  const [state, setState] = useState<HoldState>({ step: 'idle' });
  const flow = useRef<HoldFlow | null>(null);
  const reserved = useRef(onReserved);

  useEffect(() => {
    reserved.current = onReserved;
  });

  useEffect(() => {
    const current = createHoldFlow(
      { endpoints: rewardsApi, checkout },
      { offerId, language },
      (next) => {
        setState(next);
        if (next.step === 'reserved') reserved.current(next.order);
      },
    );
    flow.current = current;
    return () => {
      current.stop();
      flow.current = null;
    };
  }, [checkout, offerId, language]);

  const text = stepText(state, t, language);
  const done = state.step === 'reserved' || state.step === 'unconfirmed';
  return (
    <div className="pay">
      {!done && (
        <PayPalButton disabled={isHolding(state)} onClick={() => flow.current?.reserve()} />
      )}
      {text !== null && (
        <p className={`pay-step ${state.step}`} role="status">
          {text}
        </p>
      )}
    </div>
  );
}

/** Reserving an offer with PayPal: a hold now, the charge when the merchant scans the code. */
export function ReserveWithPayPal({ offerId, onReserved }: Props) {
  const t = useRewardsT().hold;
  const locale = useLocale();
  const [attempt, setAttempt] = useState(0);
  const checkout = useCheckout(locale, attempt);
  return (
    <div className="pay-box reward-hold">
      <p className="reward-hold-note">{t.note}</p>
      {checkout.status === 'loading' && <p className="pay-step">{t.loading}</p>}
      {checkout.status === 'unavailable' && (
        <p className="pay-step">{t.unavailable(checkout.reason)}</p>
      )}
      {checkout.status === 'not-eligible' && <p className="pay-step">{t.notEligible}</p>}
      {checkout.status === 'failed' && (
        <div className="pay-failed">
          <p className="pay-step">{t.loadFailed}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setAttempt((n) => n + 1);
            }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {checkout.status === 'ready' && (
        <HoldSteps checkout={checkout.checkout} offerId={offerId} onReserved={onReserved} />
      )}
    </div>
  );
}
