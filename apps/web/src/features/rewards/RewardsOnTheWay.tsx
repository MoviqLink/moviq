import type { NeedView } from '@moviq/contracts';
import { useEffect, useId, useState, type SubmitEvent } from 'react';

import { ApiRequestError } from '../../shared/api/errors';
import { useLang } from '../../shared/i18n/lang';
import { rewardsApi } from './api';
import { useRewardsT } from './texts';
import { NeedPanel } from './ui/NeedPanel';
import { PromotionsOnTheWay } from './ui/PromotionsOnTheWay';
import { ShopperForm } from './ui/ShopperForm';
import { useShopper } from './useShopper';
import './rewards.css';

type Asking = 'idle' | 'asking' | 'failed' | 'not-watched';

interface Props {
  readonly journeyId: string;
  /** A need Sara passed to the merchants from her own field; shown here once it arrives. */
  readonly fromSara: string | null;
}

/** The need Sara opened, read from the server whenever she opens a new one. */
function useSaraNeed(needId: string | null, show: (need: NeedView) => void): void {
  useEffect(() => {
    if (needId === null) return;
    const controller = new AbortController();
    rewardsApi.need(needId, controller.signal).then(show, () => undefined);
    return () => {
      controller.abort();
    };
  }, [needId, show]);
}

/**
 * Rewards on the trip: "something on the way" goes to the demo merchants the trip passes, with
 * the alias and tastes of this device; their questions and offers follow, reserved with PayPal.
 */
export function RewardsOnTheWay({ journeyId, fromSara }: Props) {
  const t = useRewardsT();
  const lang = useLang();
  const field = useId();
  const { shopper, save } = useShopper();
  const [craving, setCraving] = useState('');
  const [asking, setAsking] = useState<Asking>('idle');
  const [need, setNeed] = useState<NeedView | null>(null);
  useSaraNeed(fromSara, setNeed);

  const ask = (value: string) => {
    const text = value.trim();
    if (text.length < 2 || asking === 'asking') return;
    setAsking('asking');
    const request = { craving: text, ...shopper, route: { journeyId }, language: lang };
    rewardsApi.ask(request).then(
      (opened) => {
        setNeed(opened);
        setAsking('idle');
      },
      (error: unknown) => {
        const gone = error instanceof ApiRequestError && error.failure.kind === 'http';
        setAsking(gone && error.failure.status === 404 ? 'not-watched' : 'failed');
      },
    );
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    ask(craving);
  };

  return (
    <section className="rewards-trip" aria-labelledby={`${field}-title`}>
      <h2 id={`${field}-title`} className="reward-section-title">
        {t.title}
      </h2>
      <p className="reward-quiet">{t.onTrip}</p>
      <PromotionsOnTheWay journeyId={journeyId} disabled={asking === 'asking'} onAsk={ask} />
      <form className="ask-sara reward-ask" onSubmit={submit}>
        <label htmlFor={field}>{t.ask.label}</label>
        <div className="ask-row">
          <input
            id={field}
            type="text"
            minLength={2}
            maxLength={80}
            autoComplete="off"
            placeholder={t.ask.placeholder}
            value={craving}
            onChange={(event) => {
              setCraving(event.target.value);
            }}
          />
          <button type="submit" disabled={asking === 'asking' || craving.trim().length < 2}>
            {t.ask.send}
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {asking === 'asking' && <p className="reward-quiet">{t.ask.asking}</p>}
        {asking === 'failed' && <p className="reward-quiet">{t.ask.failed}</p>}
        {asking === 'not-watched' && <p className="reward-quiet">{t.ask.noTrip}</p>}
      </div>
      {need !== null && <NeedPanel key={need.id} need={need} onNeed={setNeed} />}
      <ShopperForm shopper={shopper} onSave={save} />
    </section>
  );
}
