import type { Place, PlanResponse } from '@moviq/contracts';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../../shared/i18n';
import { useNow } from '../../shared/time/clock';
import { formatCityTime } from '../../shared/time/city';
import { virtualApi } from './api';
import { useVirtualT } from './texts';

export function RouteEstimate({
  rideId,
  offerId,
  origin,
  onVerified,
}: {
  rideId: string;
  offerId: string;
  origin: Place | null;
  onVerified: (id: string, departAt: number | null) => void;
}) {
  const t = useVirtualT();
  const locale = useLocale();
  const now = useNow();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const estimate = async () => {
    if (origin === null || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPlan(null);
    setFailed(false);
    onVerified(offerId, null);
    try {
      const result = await virtualApi.estimate(rideId, offerId, origin, controller.signal);
      if (controller.signal.aborted) return;
      const route = result.plan.itineraries.find((item) => item.id === result.plan.recommendedId);
      if (route === undefined || Date.parse(route.departAt) <= Date.now()) {
        setFailed(true);
        return;
      }
      setPlan(result.plan);
      onVerified(offerId, Date.parse(route.departAt));
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const itinerary =
    plan?.itineraries.find((item) => item.id === plan.recommendedId) ?? plan?.itineraries[0];
  return (
    <div className="virtual-estimate">
      <p>{t.chooseOrigin}</p>
      <button
        type="button"
        className="btn small"
        disabled={origin === null || busy}
        onClick={() => {
          void estimate();
        }}
      >
        {busy ? t.estimating : t.estimate}
      </button>
      {itinerary !== undefined && Date.parse(itinerary.departAt) > now && (
        <p>
          {t.arrivesIn(Math.max(0, Math.ceil((Date.parse(itinerary.arriveAt) - now) / 60_000)))} ·{' '}
          {formatCityTime(itinerary.arriveAt, locale)}
        </p>
      )}
      {itinerary !== undefined && Date.parse(itinerary.departAt) <= now && (
        <p role="status">{t.routeExpired}</p>
      )}
      {plan?.notices.map((notice) => (
        <p key={notice}>{notice}</p>
      ))}
      {failed && <p role="alert">{t.estimateFailed}</p>}
    </div>
  );
}
