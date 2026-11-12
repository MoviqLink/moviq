import { useState } from 'react';

import { useLang } from '../../../shared/i18n/lang';
import { merchantApi } from '../api';
import { proposalChanges } from '../model/proposal';
import type { AgentProposal, AgentSetup, AgentTalk as TalkAnswer } from '../schemas';
import { useMerchantT } from '../texts';
import { useAction } from '../useAction';
import { ProblemNote } from '../ui/ProblemNote';

interface Turn {
  readonly id: number;
  readonly who: 'you' | 'agent';
  readonly text: string;
  /** The server's own sentence (English) when it would refuse the change the agent wanted. */
  readonly refused: string | null;
}

/** The agent's answer as a turn of the conversation, and the change it proposes, if any. */
function turnOf(answer: TalkAnswer, id: number, t: ReturnType<typeof useMerchantT>['talk']) {
  if (answer.mode === 'answer') {
    const turn: Turn = { id, who: 'agent', text: answer.reply, refused: answer.refused };
    return { turn, proposal: answer.proposal };
  }
  const text = answer.mode === 'off' ? t.off : t.unavailable;
  return { turn: { id, who: 'agent', text, refused: null } satisfies Turn, proposal: null };
}

/** A change the agent proposes, line by line, saved only if the merchant confirms it. */
function Proposal(props: {
  setup: AgentSetup;
  proposal: AgentProposal;
  onDone: (said: string, saved: boolean) => void;
}) {
  const t = useMerchantT();
  const save = useAction();
  const changes = proposalChanges(props.setup, props.proposal, t);
  const stale = props.proposal.version !== props.setup.version;
  const apply = () => {
    const { rules, hours, version } = props.proposal;
    void save
      .run(() => merchantApi.saveAgent(rules, hours, version))
      .then((saved) => {
        if (saved !== undefined) props.onDone(t.talk.applied, true);
      });
  };
  return (
    <div className="mc-proposal" role="group" aria-label={t.talk.proposal}>
      <p className="mc-label">{t.talk.proposal}</p>
      <ul>
        {(changes.length === 0 ? [t.talk.nothingChanges] : changes).map((line) => (
          <li key={line} className="mono">
            {line}
          </li>
        ))}
      </ul>
      {stale && <p className="error">{t.talk.stale}</p>}
      <ProblemNote failure={save.failure} />
      <div className="mc-proposal-end">
        <button
          type="button"
          className="btn primary small"
          onClick={apply}
          disabled={save.pending || stale || changes.length === 0}
        >
          {save.pending ? t.talk.applying : t.talk.apply}
        </button>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            props.onDone(t.talk.dismissed, false);
          }}
        >
          {t.talk.dismiss}
        </button>
      </div>
    </div>
  );
}

/** The conversation so far, on its line: the merchant and the agent, in order. */
function TalkTurns({ turns }: { turns: readonly Turn[] }) {
  const t = useMerchantT().talk;
  if (turns.length === 0) return null;
  return (
    <ol className="mc-talk" aria-label={t.label}>
      {turns.map((turn) => (
        <li key={turn.id} className={`mc-talk-turn mc-talk-${turn.who}`}>
          <p className="mc-label">{turn.who === 'you' ? t.you : t.agent}</p>
          <p>{turn.text}</p>
          {turn.refused !== null && (
            <p className="mc-note">
              {t.refused} <q lang="en">{turn.refused}</q>
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function TalkForm(props: {
  draft: string;
  pending: boolean;
  onDraft: (text: string) => void;
  onSend: () => void;
}) {
  const t = useMerchantT().talk;
  return (
    <form
      className="mc-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSend();
      }}
    >
      <div className="field">
        <label htmlFor="mc-talk-message">{t.message}</label>
        <textarea
          id="mc-talk-message"
          rows={2}
          maxLength={400}
          value={props.draft}
          placeholder={t.placeholder}
          onChange={(event) => {
            props.onDraft(event.target.value);
          }}
        />
      </div>
      <button
        type="submit"
        className="btn primary"
        disabled={props.pending || props.draft.trim() === ''}
      >
        {t.send}
      </button>
    </form>
  );
}

/**
 * F-J9-14: the merchant talks with its agent, which answers from its real rules. A change it
 * proposes has passed the server's check and is saved, through the same `PUT`, only when the
 * merchant confirms it. Without the AI model the panel says so and points to the form.
 */
export function AgentTalk({
  setup,
  onSaved,
}: {
  setup: AgentSetup;
  onSaved: (said: string) => void;
}) {
  const t = useMerchantT().talk;
  const lang = useLang();
  const ask = useAction();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [draft, setDraft] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const send = () => {
    const message = draft.trim();
    if (message === '') return;
    setSaid(null);
    setProposal(null);
    const mine: Turn = { id: turns.length, who: 'you', text: message, refused: null };
    setTurns((old) => [...old, mine]);
    setDraft('');
    void ask
      .run(() => merchantApi.talk(message, lang))
      .then((answer) => {
        if (answer === undefined) return;
        const next = turnOf(answer, mine.id + 1, t);
        setTurns((old) => [...old, next.turn]);
        setProposal(next.proposal);
      });
  };
  return (
    <section className="mc-panel" aria-labelledby="mc-talk-title">
      <h2 id="mc-talk-title" className="mc-panel-title">
        {t.title}
      </h2>
      {!setup.talk ? (
        <div className="mc-talk-off">
          <p>{t.off}</p>
          <a className="btn small" href="#mc-rule-maxDiscountPercent">
            {t.toForm}
          </a>
        </div>
      ) : (
        <>
          <p className="mc-note">{t.lead}</p>
          <TalkTurns turns={turns} />
          {proposal !== null && (
            <Proposal
              setup={setup}
              proposal={proposal}
              onDone={(text, saved) => {
                setProposal(null);
                setSaid(text);
                if (saved) onSaved(text);
              }}
            />
          )}
          <p className="mc-said" role="status">
            {ask.pending ? t.sending : said}
          </p>
          <ProblemNote failure={ask.failure} />
          <TalkForm draft={draft} pending={ask.pending} onDraft={setDraft} onSend={send} />
        </>
      )}
    </section>
  );
}
