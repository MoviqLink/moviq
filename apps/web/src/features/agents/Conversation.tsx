import type { AgentDetail } from '@moviq/contracts';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type SubmitEvent,
  useEffectEvent,
} from 'react';
import { useLang } from '../../shared/i18n/lang';
import { ThinkingBar } from '../../shared/ui/ThinkingBar';
import { TicketPass } from '../tickets/TicketPass';
import { agentsApi } from './api';
import { takePendingAsk } from '../../shared/routing/pending-ask';
import { useAgentsT } from './texts';
import { Choices } from './Choices';
import { TripCard } from './TripCard';

type Message = AgentDetail['messages'][number];
type CityBlock = NonNullable<Message['answer']>['city'][number];
type BoughtTickets = NonNullable<NonNullable<Message['answer']>['tickets']>;

function Bought({ tickets }: { tickets: BoughtTickets }) {
  const t = useAgentsT();
  if (tickets.length === 0) return null;
  return (
    <section className="agents-bought" aria-label={t.bought}>
      {tickets.map((ticket) => (
        <TicketPass key={ticket.id} ticket={ticket} />
      ))}
    </section>
  );
}

function CityAnswer({ city }: { city: CityBlock }) {
  return (
    <div className="agents-answer">
      <strong>{city.headline}</strong>
      {city.items.map((item, index) => (
        <p key={index}>{item.text}</p>
      ))}
      {city.sources.map((source) => (
        <p className="agents-source" key={source.sourceId}>
          {source.title} · {source.state}
          {source.dataTime === null ? '' : ` · ${new Date(source.dataTime).toLocaleString()}`}
        </p>
      ))}
    </div>
  );
}

function Bubble({ who, text, mine }: { who: string; text: string; mine: boolean }) {
  return (
    <article className={`agents-bubble ${mine ? 'mine' : 'hers'}`}>
      <span className="agents-who">{who}</span>
      <p>{text}</p>
    </article>
  );
}

/**
 * The answers that bring a trip not shown yet: a plan stays in Sara's answers while the
 * conversation goes on, and its card is drawn once, where it first appears.
 */
function newPlans(messages: AgentDetail['messages']): ReadonlySet<string> {
  const fresh = new Set<string>();
  let shown: string | null = null;
  for (const entry of messages) {
    const plan = entry.answer?.plan;
    if (plan === null || plan === undefined) continue;
    const key = `${plan.recommendedId ?? ''}|${plan.itineraries[0]?.departAt ?? ''}`;
    if (key !== shown) fresh.add(entry.id);
    shown = key;
  }
  return fresh;
}

function ConversationThread({
  detail,
  pending,
  onAsk,
}: {
  detail: AgentDetail;
  pending: string | null;
  onAsk: (text: string) => void;
}) {
  const t = useAgentsT();
  const end = useRef<HTMLDivElement>(null);
  const count = detail.messages.length;
  useEffect(() => {
    const thread = end.current?.parentElement;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [count, pending]);
  const name = detail.agent.name;
  const fresh = newPlans(detail.messages);
  return (
    <div className="agents-thread" aria-label={t.chat} aria-live="polite">
      {detail.agent.primary && <Bubble who={name} text={t.greeting} mine={false} />}
      {detail.messages.map((entry, index) => {
        const mine = entry.role === 'user';
        const choices = index === count - 1 ? entry.answer?.choices : undefined;
        const plan = entry.answer?.plan ?? null;
        const tickets = entry.answer?.tickets;
        return (
          <article key={entry.id} className={`agents-bubble ${mine ? 'mine' : 'hers'}`}>
            <span className="agents-who">{mine ? t.you : name}</span>
            <p>{entry.text}</p>
            {entry.answer?.city.map((city) => (
              <CityAnswer key={`${city.kind}-${city.subject}`} city={city} />
            ))}
            {!mine && choices !== undefined && (
              <Choices
                slot={choices.slot}
                options={choices.options}
                disabled={pending !== null}
                onPick={onAsk}
              />
            )}
            {!mine && plan !== null && fresh.has(entry.id) && (
              <TripCard plan={plan} disabled={pending !== null} onBuy={onAsk} />
            )}
            {!mine && tickets !== undefined && <Bought tickets={tickets} />}
          </article>
        );
      })}
      {pending !== null && <Bubble who={t.you} text={pending} mine />}
      {pending !== null && (
        <div className="agents-bubble hers agents-thinking">
          <ThinkingBar label={detail.agent.primary ? t.thinking : `${name}…`} />
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Suggestions({ disabled, onPick }: { disabled: boolean; onPick: (text: string) => void }) {
  const t = useAgentsT();
  return (
    <div className="agents-suggestions" role="group" aria-label={t.suggestionsLabel}>
      {t.suggestions.map((text) => (
        <button
          key={text}
          type="button"
          disabled={disabled}
          onClick={() => {
            onPick(text);
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A question written on another screen arrives here and is sent once. */
function usePendingAsk(send: (text: string) => void): void {
  const sendPending = useEffectEvent(() => {
    const waiting = takePendingAsk();
    if (waiting !== null) send(waiting);
  });
  useEffect(() => {
    const timer = window.setTimeout(sendPending, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
}

/** Sara's name over the conversation, and the way to start it afresh. */
function ConversationHead({
  name,
  disabled,
  onClear,
}: {
  name: string;
  disabled: boolean;
  onClear: () => void;
}) {
  const t = useAgentsT();
  return (
    <div className="agents-conversation-head">
      <h2 className="agents-heading">{name}</h2>
      <button type="button" className="agents-clear" disabled={disabled} onClick={onClear}>
        {t.clearChat}
      </button>
    </div>
  );
}

export function Conversation({
  detail,
  onChange,
}: {
  detail: AgentDetail;
  onChange: (value: AgentDetail) => void;
}) {
  const t = useAgentsT();
  const lang = useLang();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function send(text: string) {
    const clean = text.trim();
    if (!clean || pending !== null) return;
    setPending(clean);
    setMessage('');
    setFailed(false);
    try {
      await agentsApi.turn(detail.agent.id, clean, lang);
      onChange(await agentsApi.detail(detail.agent.id));
    } catch {
      setMessage(clean);
      setFailed(true);
    } finally {
      setPending(null);
    }
  }
  usePendingAsk((text) => void send(text));
  function submit(event: SubmitEvent) {
    event.preventDefault();
    void send(message);
  }
  function enter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send(message);
  }
  return (
    <section className="agents-conversation">
      <ConversationHead
        name={detail.agent.name}
        disabled={pending !== null || detail.messages.length === 0}
        onClear={() => {
          void agentsApi.clear(detail.agent.id).then(onChange, () => {
            setFailed(true);
          });
        }}
      />
      <ConversationThread detail={detail} pending={pending} onAsk={(text) => void send(text)} />
      {failed && <p role="alert">{t.failed}</p>}
      <Suggestions disabled={pending !== null} onPick={(text) => void send(text)} />
      <form className="agents-composer" onSubmit={submit}>
        <label className="agents-hidden" htmlFor="agent-message">
          {t.message}
        </label>
        <textarea
          id="agent-message"
          maxLength={2000}
          rows={3}
          placeholder={t.placeholder}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
          }}
          onKeyDown={enter}
          required
        />
        <div className="agents-composer-bar">
          <span>{t.enterHint}</span>
          <button type="submit" className="agents-send" disabled={pending !== null}>
            {t.send}
          </button>
        </div>
      </form>
      <p className="agents-fine">{t.privacy}</p>
    </section>
  );
}
