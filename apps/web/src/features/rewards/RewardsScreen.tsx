import { useTrips } from '../home/trips/useTrips';
import { travellerHref } from '../../shared/routing/hrefs';
import { useRewardsT } from './texts';
import { MyOrders } from './ui/MyOrders';
import { ShopperForm } from './ui/ShopperForm';
import { useShopper } from './useShopper';
import './rewards.css';

/** Where to ask: the trips under watch in this browser, or planning one with Sara. */
function WhereToAsk() {
  const t = useRewardsT().ask;
  const { trips } = useTrips();
  const watched = trips.flatMap((trip) =>
    trip.state === 'ready' && trip.journey.state === 'watching' ? [trip.journey] : [],
  );
  if (watched.length === 0) {
    return (
      <div className="rewards-where">
        <p className="reward-quiet">{t.noTrip}</p>
        <a className="btn primary" href={travellerHref.plan}>
          {t.plan}
        </a>
      </div>
    );
  }
  return (
    <ul className="rewards-where">
      {watched.map((journey) => (
        <li key={journey.id}>
          <a className="btn" href={travellerHref.trip(journey.id)}>
            {`${t.toTrip} · ${journey.request.destination.label}`}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** `#/rewards`: what Sara tells the merchants, where to ask, and "My orders" with their codes. */
export function RewardsScreen() {
  const t = useRewardsT();
  const { shopper, save } = useShopper();
  return (
    <>
      <main id="main" className="rewards" tabIndex={-1}>
        <header className="rewards-head">
          <h1>{t.title}</h1>
          <p className="rewards-lead">{t.lead}</p>
        </header>
        <WhereToAsk />
        <ShopperForm shopper={shopper} onSave={save} />
        <MyOrders />
      </main>
    </>
  );
}
