import type { PlanResponse } from '@moviq/contracts';
import { useState } from 'react';

import { orderItineraries } from '../../../shared/journey/order';
import { usePlanT } from '../texts';
import { ItineraryRow } from './ItineraryRow';

/**
 * The ways to get there, recommended first and opened. Keyed by the plan's id where it is used, so
 * a new plan starts with its own recommended one open.
 */
export function PlanResult({ plan }: { plan: PlanResponse }) {
  const t = usePlanT().plan;
  const ordered = orderItineraries(plan);
  const [openId, setOpenId] = useState<string | null>(ordered[0]?.id ?? null);
  return (
    <section className="plan-result" aria-labelledby="plan-result-title">
      <h2 id="plan-result-title">{ordered.length === 0 ? t.none : t.found(ordered.length)}</h2>
      {plan.notices.map((notice) => (
        <p key={notice} className="plan-notice">
          {notice}
        </p>
      ))}
      <ol className="itins">
        {ordered.map((itinerary) => (
          <ItineraryRow
            key={itinerary.id}
            planId={plan.planId}
            itinerary={itinerary}
            recommended={itinerary.id === plan.recommendedId}
            open={openId === itinerary.id}
            onToggle={() => {
              setOpenId((current) => (current === itinerary.id ? null : itinerary.id));
            }}
          />
        ))}
      </ol>
    </section>
  );
}
