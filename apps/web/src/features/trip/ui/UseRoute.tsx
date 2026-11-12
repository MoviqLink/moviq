import type { Journey } from '@moviq/contracts';
import { useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { tripApi } from '../api';
import { useTripT } from '../texts';

type State = 'idle' | 'applying' | 'conflict' | 'gone' | 'failed';

interface Props {
  readonly journeyId: string;
  readonly alternativeId: string;
  readonly onBusy: (busy: boolean) => void;
  /** The journey as the server changed it. */
  readonly onApplied: (journey: Journey) => void;
  /** The option is no longer on offer: the journey should be asked for again. */
  readonly onGone: () => void;
}

/**
 * Takes a free alternative. The server changes the journey and answers with it; until then the
 * button and the options stay locked, and a refusal says that nothing changed.
 */
export function UseRoute({ journeyId, alternativeId, onBusy, onApplied, onGone }: Props) {
  const t = useTripT().use;
  const [state, setState] = useState<State>('idle');

  const apply = () => {
    if (state === 'applying') return;
    setState('applying');
    onBusy(true);
    void tripApi.applyAlternative(journeyId, alternativeId).then(
      (journey) => {
        onBusy(false);
        onApplied(journey);
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        onBusy(false);
        if (error.code === 'conflict') setState('conflict');
        else if (error.code === 'not_found') {
          setState('gone');
          onGone();
        } else setState('failed');
      },
    );
  };

  const message = state === 'idle' || state === 'applying' ? null : t[state];
  return (
    <div className="use-route">
      <button type="button" className="btn primary" onClick={apply} disabled={state === 'applying'}>
        {state === 'applying' ? t.applying : t.action}
      </button>
      {message !== null && (
        <p className="pay-step failed" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
