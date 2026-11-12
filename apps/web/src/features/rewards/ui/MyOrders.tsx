import type { OrderView } from '@moviq/contracts';
import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../../shared/api/errors';
import { rewardsApi } from '../api';
import { ordersInOrder } from '../model/need';
import { useRewardsT } from '../texts';
import { OrderCard } from './OrderCard';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly orders: readonly OrderView[] };

/** "My orders": every order of this device, still to collect first, each with its code. */
export function MyOrders() {
  const t = useRewardsT().orders;
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    rewardsApi.orders(controller.signal).then(
      (orders) => {
        setLoad({ state: 'ready', orders });
      },
      (error: unknown) => {
        if (error instanceof ApiRequestError && error.failure.kind === 'aborted') return;
        setLoad({ state: 'failed' });
      },
    );
    return () => {
      controller.abort();
    };
  }, [attempt]);
  const replace = (changed: OrderView) => {
    if (load.state !== 'ready') return;
    setLoad({
      state: 'ready',
      orders: load.orders.map((o) => (o.id === changed.id ? changed : o)),
    });
  };
  return (
    <section className="reward-orders" aria-labelledby="my-orders">
      <h2 id="my-orders" className="reward-section-title">
        {t.title}
      </h2>
      {load.state === 'loading' && <p className="reward-quiet">{t.loading}</p>}
      {load.state === 'failed' && (
        <div className="pay-failed">
          <p className="reward-quiet">{t.failed}</p>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setLoad({ state: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            {t.retry}
          </button>
        </div>
      )}
      {load.state === 'ready' && load.orders.length === 0 && (
        <p className="reward-quiet">{t.empty}</p>
      )}
      {load.state === 'ready' && load.orders.length > 0 && (
        <ol className="reward-order-list">
          {ordersInOrder(load.orders).map((order) => (
            <li key={order.id}>
              <OrderCard order={order} onChange={replace} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
