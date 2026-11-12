import type { NeedView, OrderView, Reservation, RewardOffer } from '@moviq/contracts';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' as const });

const merchant = {
  id: 'demo-tsuki-ramen-house',
  name: 'Tsuki Ramen House',
  kind: 'restaurant' as const,
  demo: true as const,
  stop: { id: '403671', name: 'East 125th Street & Lexington Avenue', routes: ['M60'] },
  walkMinutes: 2,
  lat: 40.803558,
  lon: -73.937307,
};

/** An offer as the server validated it: 14.41 instead of 16.95, ready at 18:20 in New York. */
export function offer(overrides: Partial<RewardOffer> = {}): RewardOffer {
  return {
    id: 'offer-1',
    merchant,
    lines: [
      {
        name: 'Vegan miso ramen',
        quantity: 1,
        changes: 'without scallions, without peanut chili oil',
      },
    ],
    reward: { listPrice: usd(1695), price: usd(1441), earned: usd(254), percent: 14 },
    pickupAt: '2026-11-11T23:20:00.000Z',
    detourMinutes: 4,
    note: 'No scallions or peanut chili oil, as your tastes say.',
    composer: 'rules',
    recommended: false,
    status: 'open',
    expiresAt: '2026-11-11T23:40:00.000Z',
    ...overrides,
  };
}

export function need(overrides: Partial<NeedView> = {}): NeedView {
  return {
    id: 'need-1',
    craving: 'ramen',
    createdAt: '2026-11-11T22:31:00.000Z',
    offers: [],
    threads: [],
    message: null,
    ...overrides,
  };
}

export function order(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: 'order-1',
    code: 'T-1041',
    merchant,
    status: 'reserved',
    lines: offer().lines,
    reward: offer().reward,
    pickupAt: '2026-11-11T23:20:00.000Z',
    kitchenStartsAt: '2026-11-11T23:08:00.000Z',
    freeCancellation: true,
    payment: {
      holdId: 'hold-1',
      status: 'authorized',
      authorized: usd(1441),
      captured: usd(0),
      refunded: usd(0),
      refundPending: usd(0),
    },
    pickup: { qr: 'm1.order-1.nonce.1794519000.signature', expiresAt: '2099-01-01T00:00:00.000Z' },
    ...overrides,
  };
}

export const reservation: Reservation = {
  holdId: 'hold-1',
  paypalOrderId: 'PAYPAL-ORDER-1',
  amount: usd(1441),
  status: 'created',
};
