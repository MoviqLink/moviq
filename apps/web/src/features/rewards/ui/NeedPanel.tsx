import type { NeedView, OrderView, RewardOffer } from '@moviq/contracts';
import { useState, type ReactNode } from 'react';

import { travellerHref } from '../../../shared/routing/hrefs';
import { rewardsApi } from '../api';
import { noOfferText, offersOf, questionsOf, type Question } from '../model/need';
import { useRewardsT } from '../texts';
import { OfferRow } from './OfferRow';
import { OrderCard } from './OrderCard';

/** A merchant's question with its answers; Sara sends the one chosen, as the merchant wrote it. */
function Ask(props: { question: Question; onAnswer: (value: string) => Promise<void> }) {
  const { question, onAnswer } = props;
  const t = useRewardsT().question;
  const [sent, setSent] = useState<'no' | 'sending' | 'failed'>('no');
  return (
    <div className="reward-question" role="group" aria-label={t.title}>
      <p className="reward-kicker">{t.title}</p>
      <p className="reward-question-text">{question.text}</p>
      <div className="reward-answers">
        {question.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="btn small"
            disabled={sent === 'sending'}
            onClick={() => {
              setSent('sending');
              onAnswer(option.value).catch(() => {
                setSent('failed');
              });
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      {sent !== 'no' && (
        <p className="reward-quiet" role="status">
          {sent === 'sending' ? t.sending : t.failed}
        </p>
      )}
    </div>
  );
}

interface Props {
  readonly need: NeedView;
  readonly onNeed: (need: NeedView) => void;
  readonly onReserved?: (offerId: string, order: OrderView) => void;
  readonly beforeReserve?: (offer: RewardOffer) => ReactNode;
  readonly canReserve?: (offer: RewardOffer) => boolean;
}

/** A need on the way: the merchants' questions, then their offers in rows, recommended first. */
export function NeedPanel({ need, onNeed, onReserved, beforeReserve, canReserve }: Props) {
  const t = useRewardsT();
  const offers = offersOf(need);
  // Until the traveller opens or closes one, the first offer (Sara's recommendation) is open.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const open = chosen === undefined ? (offers[0]?.id ?? null) : chosen;
  const [order, setOrder] = useState<OrderView | null>(null);
  const questions = questionsOf(need, t.question);
  const none = noOfferText(need, t.offers);
  const declined = (offer: RewardOffer) => {
    onNeed({ ...need, offers: need.offers.map((o) => (o.id === offer.id ? offer : o)) });
  };
  const answer = (threadId: string) => (value: string) =>
    rewardsApi.answer(need.id, threadId, value).then(onNeed);
  if (order !== null) {
    return (
      <div className="reward-need">
        <OrderCard order={order} onChange={setOrder} />
        <a className="link" href={travellerHref.rewards}>
          {t.orders.link}
        </a>
      </div>
    );
  }
  return (
    <div className="reward-need" aria-live="polite">
      {questions.map((question) => (
        <Ask key={question.threadId} question={question} onAnswer={answer(question.threadId)} />
      ))}
      {offers.length > 0 && (
        <section aria-label={t.offers.title(offers.length)}>
          <h3 className="reward-section-title">{t.offers.title(offers.length)}</h3>
          <ol className="reward-offers">
            {offers.map((offer) => (
              <OfferRow
                key={offer.id}
                offer={offer}
                open={open === offer.id}
                onToggle={() => {
                  setChosen(open === offer.id ? null : offer.id);
                }}
                onDeclined={declined}
                beforeReserve={beforeReserve?.(offer)}
                canReserve={canReserve?.(offer) ?? true}
                onReserved={(reserved) => {
                  setOrder(reserved);
                  onReserved?.(offer.id, reserved);
                }}
              />
            ))}
          </ol>
        </section>
      )}
      {need.offers.some((o) => o.status === 'declined') && offers.length === 0 && (
        <p className="reward-quiet">{t.offers.declined}</p>
      )}
      {questions.length === 0 && none !== null && <p className="reward-quiet">{none}</p>}
    </div>
  );
}
