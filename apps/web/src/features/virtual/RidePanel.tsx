import type { NeedView, Place, VirtualRide } from '@moviq/contracts';
import { useState } from 'react';
import { travellerHref } from '../../shared/routing/hrefs';
import { useNow } from '../../shared/time/clock';
import { ageText } from '../explore/model/card';
import { secondsSince } from '../explore/model/vehicle';
import { SourceCredit } from '../explore/ui/SourceCredit';
import { NeedPanel } from '../rewards/ui/NeedPanel';
import { OrderCard } from '../rewards/ui/OrderCard';
import { virtualApi } from './api';
import { OriginChooser } from './OriginChooser';
import { Suggestions } from './Suggestions';
import { RouteEstimate } from './RouteEstimate';
import { useVirtualT } from './texts';
import '../rewards/rewards.css';
import './virtual.css';

interface Actions {
  readonly getOff: () => void;
  readonly refresh: () => void;
  readonly replaceNeed: (need: NeedView) => void;
}
function RealTrip({
  ride,
  offerId,
  refresh,
}: {
  ride: VirtualRide;
  offerId: string;
  refresh: () => void;
}) {
  const t = useVirtualT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const plan = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await virtualApi.journey(ride.id, offerId);
      refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (ride.journeyId !== null)
    return (
      <a className="link" href={travellerHref.trip(ride.journeyId)}>
        {t.trip}
      </a>
    );
  return (
    <>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={() => {
          void plan();
        }}
      >
        {busy ? t.planning : t.plan}
      </button>
      {failed && <p role="alert">{t.planFailed}</p>}
    </>
  );
}
function Reservations({ ride, refresh }: { ride: VirtualRide; refresh: () => void }) {
  return (
    <>
      {ride.orders.map(({ offerId, order }) => (
        <div key={order.id}>
          <OrderCard order={order} onChange={refresh} />
          <RealTrip ride={ride} offerId={offerId} refresh={refresh} />
        </div>
      ))}
    </>
  );
}
function RideHeader({
  ride,
  busy,
  failed,
  getOff,
}: {
  ride: VirtualRide;
  busy: boolean;
  failed: boolean;
  getOff: () => void;
}) {
  const t = useVirtualT();
  const now = useNow();
  const source = ride.sources.find((item) => item.provenance.sourceId === ride.vehicle.sourceId);
  const age = secondsSince(ride.vehicle.position.dataTime, now);
  return (
    <header className="ex-card-head">
      <h2>{t.title}</h2>
      <p className="ex-to">
        <b>{ride.vehicle.line?.name ?? ride.vehicle.name}</b> ·{' '}
        {ride.vehicle.destination?.name ?? '—'}
      </p>
      <p role="status">
        {failed ? t.unknownGps : ride.status === 'following' ? t.following : t.lost}
      </p>
      <p>{t.age(ageText(age))}</p>
      {source !== undefined && <SourceCredit source={source} />}
      <button type="button" className="btn small" disabled={busy} onClick={getOff}>
        {busy ? t.gettingOff : t.getOff}
      </button>
    </header>
  );
}
export function RidePanel({
  ride,
  busy,
  failed,
  actions,
}: {
  ride: VirtualRide;
  busy: boolean;
  failed: boolean;
  actions: Actions;
}) {
  const t = useVirtualT();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [verified, setVerified] = useState<ReadonlyMap<string, number>>(new Map());
  const now = useNow();
  const orderOffers = new Set(ride.orders.map((entry) => entry.offerId));
  const pendingNeeds = ride.needs.filter(
    (need) => !need.offers.some((offer) => orderOffers.has(offer.id)),
  );
  return (
    <article className="ex-card virtual-ride" aria-label={t.title}>
      <RideHeader ride={ride} busy={busy} failed={failed} getOff={actions.getOff} />
      {failed && <p role="alert">{t.connection}</p>}
      <Suggestions
        ride={ride}
        onRefresh={actions.refresh}
        stale={failed || ride.status !== 'following'}
      />
      {pendingNeeds.some((need) => need.offers.some((offer) => offer.status === 'open')) && (
        <OriginChooser
          origin={origin}
          onChange={(place) => {
            setOrigin(place);
            setVerified(new Map());
          }}
        />
      )}
      {pendingNeeds.map((need) => (
        <NeedPanel
          key={need.id}
          need={need}
          onNeed={actions.replaceNeed}
          onReserved={() => {
            actions.refresh();
          }}
          canReserve={(offer) => (verified.get(offer.id) ?? 0) > now}
          beforeReserve={(offer) => (
            <RouteEstimate
              key={`${offer.id}:${String(origin?.lat ?? '')}:${String(origin?.lon ?? '')}`}
              rideId={ride.id}
              offerId={offer.id}
              origin={origin}
              onVerified={(id, departAt) => {
                setVerified((current) => {
                  const next = new Map(current);
                  if (departAt === null) next.delete(id);
                  else next.set(id, departAt);
                  return next;
                });
              }}
            />
          )}
        />
      ))}
      <Reservations ride={ride} refresh={actions.refresh} />
    </article>
  );
}
