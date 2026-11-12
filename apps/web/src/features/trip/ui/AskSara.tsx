import { useEffect, useRef, useState, type SubmitEvent } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { createLatest } from '../../../shared/api/latest';
import { useLang } from '../../../shared/i18n/lang';
import { currentShopper } from '../../rewards/useShopper';
import { tripApi } from '../api';
import { useSaraT } from '../sara-texts';
import './sara.css';

type Asked =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'answered';
      readonly reply: string;
      /** The sources of the city answers, by title. */
      readonly sources: readonly string[];
      readonly proposed: boolean;
    };

interface Props {
  readonly journeyId: string;
  /** Sara proposed one of the options: the card selects it, with its PayPal or route button. */
  readonly onProposal: (alternativeId: string) => void;
  /** Sara passed a craving to the merchants on the way: the screen shows their offers. */
  readonly onRewards: (needId: string) => void;
}

/** A question to Sara about this trip ("Will I make it?"), answered from its facts and tools. */
export function AskSara({ journeyId, onProposal, onRewards }: Props) {
  const lang = useLang();
  const s = useSaraT().ask;
  const [message, setMessage] = useState('');
  const [asked, setAsked] = useState<Asked>({ kind: 'idle' });
  const conversation = useRef<string | null>(null);
  const requests = useRef(createLatest());
  useEffect(() => {
    const latest = requests.current;
    return () => {
      latest.cancel();
    };
  }, []);

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (text === '' || asked.kind === 'asking') return;
    setAsked({ kind: 'asking' });
    try {
      const shopper = currentShopper(lang);
      const question = {
        conversationId: conversation.current,
        journeyId,
        message: text,
        lang,
        shopper,
      };
      const turn = await tripApi.ask(question, requests.current.next());
      conversation.current = turn.conversationId;
      const proposal = turn.proposal ?? null;
      if (proposal !== null) onProposal(proposal.alternativeId);
      const rewards = turn.rewards ?? null;
      if (rewards !== null) onRewards(rewards.needId);
      const sources = [...new Set(turn.city.flatMap((card) => card.sources.map((s) => s.title)))];
      setAsked({ kind: 'answered', reply: turn.reply, sources, proposed: proposal !== null });
      setMessage('');
    } catch (error) {
      if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
      setAsked({ kind: 'failed' });
    }
  };

  return (
    <form className="ask-sara" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`ask-${journeyId}`}>{s.label}</label>
      <div className="ask-row">
        <input
          id={`ask-${journeyId}`}
          type="text"
          maxLength={500}
          autoComplete="off"
          placeholder={s.placeholder}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
        />
        <button type="submit" disabled={asked.kind === 'asking' || message.trim() === ''}>
          {s.send}
        </button>
      </div>
      <div aria-live="polite">
        {asked.kind === 'asking' && <p className="sara-quiet">{s.thinking}</p>}
        {asked.kind === 'failed' && <p className="sara-quiet">{s.failed}</p>}
        {asked.kind === 'answered' && (
          <div className="sara-words" key={asked.reply}>
            <p className="sara-answer">{asked.reply}</p>
            {asked.proposed && <p className="sara-sources">{s.proposed}</p>}
            {asked.sources.length > 0 && (
              <p className="sara-sources">{asked.sources.join(' · ')}</p>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
