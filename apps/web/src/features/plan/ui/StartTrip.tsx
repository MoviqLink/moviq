import { useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { travellerHref } from '../../../shared/routing/hrefs';
import { planApi } from '../api';
import { usePlanT } from '../texts';

/**
 * Creates the journey on the server from the plan's id and the itinerary's id, never from data
 * held here, and opens its screen. The button stays locked until the server answers.
 */
export function StartTrip({ planId, itineraryId }: { planId: string; itineraryId: string }) {
  const t = usePlanT().plan;
  const [state, setState] = useState<'idle' | 'starting' | 'failed'>('idle');

  const start = () => {
    if (state === 'starting') return;
    setState('starting');
    void planApi.startJourney(planId, itineraryId).then(
      (journey) => {
        window.location.hash = travellerHref.trip(journey.id);
      },
      (error: unknown) => {
        if (!(error instanceof ApiRequestError)) throw error;
        setState('failed');
      },
    );
  };

  return (
    <div className="start-trip">
      <button type="button" className="btn primary" onClick={start} disabled={state === 'starting'}>
        {state === 'starting' ? t.starting : t.start}
      </button>
      {state === 'failed' && (
        <p className="start-failed" role="alert">
          {t.startFailed}
        </p>
      )}
    </div>
  );
}
