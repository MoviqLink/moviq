import { useRef, useState } from 'react';

import { useLang } from '../../shared/i18n/lang';
import { TopBar } from '../../shared/ui/TopBar';
import { usePlanT } from './texts';
import { useConversation } from './useConversation';
import { Composer } from './ui/Composer';
import { PlanResult } from './ui/PlanResult';
import { Thread } from './ui/Thread';
import { TurnFailure } from './ui/TurnFailure';
import { Understood } from './ui/Understood';
import './plan.css';

function Opening() {
  const t = usePlanT();
  return (
    <div className="opening">
      <h1>{t.question}</h1>
      <p className="opening-lead">{t.lead}</p>
    </div>
  );
}

/** Planning with Sara: the conversation, what she understood and, once complete, the plan. */
export function PlanScreen() {
  const t = usePlanT();
  const lang = useLang();
  const [state, store] = useConversation();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const started = state.entries.length > 0;
  const plan = state.turn?.plan ?? null;

  const send = (message: string) => {
    setText('');
    void store.send(message, lang);
  };
  const restart = () => {
    store.reset();
    setText('');
    field.current?.focus();
  };

  return (
    <>
      <TopBar variant="solid" homeLabel={t.home} skipLabel={t.skip} />
      <main id="main" className={`planner${started ? ' started' : ''}`} tabIndex={-1}>
        <section className="talk" aria-label={t.title}>
          {!started && <Opening />}
          {started && <h1 className="visually-hidden">{t.title}</h1>}
          <Thread entries={state.entries} pending={state.pending !== null} />
          {state.failed !== null && (
            <TurnFailure failure={state.failed.failure} onRetry={() => void store.retry(lang)} />
          )}
          {plan !== null && <PlanResult key={plan.planId} plan={plan} />}
          <Composer
            text={text}
            onText={setText}
            onSend={send}
            waiting={state.pending !== null}
            field={field}
            started={started}
          />
          {!started && (
            <p className="opening-example">
              {t.example}{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setText(t.exampleText);
                  field.current?.focus();
                }}
              >
                {t.useExample}
              </button>
            </p>
          )}
        </section>
        {started && <Understood turn={state.turn} onRestart={restart} />}
      </main>
    </>
  );
}
