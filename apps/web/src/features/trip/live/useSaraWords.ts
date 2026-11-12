import type { Journey } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { useLang } from '../../../shared/i18n/lang';
import { tripApi } from '../api';
import { changeKey, needsWords, saraWords, unreached, type SaraWords } from '../model/sara';

/**
 * Sara's words on the trip's latest change. When they are missing in this language, the server
 * is asked once for this change; it writes them once and the live stream brings them to every
 * open screen. Its own answer is shown at once when the stream has not brought them yet.
 */
export function useSaraWords(journey: Journey, onJourney: (journey: Journey) => void): SaraWords {
  const lang = useLang();
  const key = changeKey(journey, lang);
  const needed = needsWords(journey, lang);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const latest = useRef({ journey, onJourney });
  useEffect(() => {
    latest.current = { journey, onJourney };
  });
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    tripApi.explain(journey.id, lang, controller.signal).then(
      (answer) => {
        const current = latest.current;
        const arrived = answer.watch.explanation?.lang === lang;
        if (arrived && current.journey.watch.explanation?.lang !== lang) current.onJourney(answer);
        if (!arrived) setFailedFor(key);
      },
      (error: unknown) => {
        if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
        setFailedFor(key);
      },
    );
    return () => {
      controller.abort();
    };
  }, [journey.id, lang, key, needed]);
  const words = saraWords(journey, lang);
  return words.kind === 'writing' && failedFor === key ? unreached(journey) : words;
}
