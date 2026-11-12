import { useEffect, useRef } from 'react';

import { ThinkingBar } from '../../../shared/ui/ThinkingBar';
import type { Entry } from '../model/conversation';
import { usePlanT } from '../texts';
import { CityAnswers } from './CityAnswers';

interface Props {
  readonly entries: readonly Entry[];
  readonly pending: boolean;
}

/** What the person and Sara said, in order, with Sara thinking while an answer is on its way. */
export function Thread({ entries, pending }: Props) {
  const t = usePlanT();
  const end = useRef<HTMLDivElement>(null);
  const lastSara = entries.findLast((entry) => entry.from === 'sara');

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length, pending]);

  if (entries.length === 0) return null;
  return (
    <>
      <ol className="thread">
        {entries.map((entry) => (
          <li key={entry.id} className={`turn ${entry.from}`}>
            <span className="turn-who">{entry.from === 'sara' ? t.sara : t.you}</span>
            <p>{entry.text}</p>
            {entry.from === 'sara' && <CityAnswers answers={entry.city} />}
          </li>
        ))}
        {pending && (
          <li className="turn sara waiting">
            <span className="turn-who">{t.sara}</span>
            <ThinkingBar label={t.thinking} />
          </li>
        )}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {lastSara?.text}
      </p>
      <div ref={end} />
    </>
  );
}
