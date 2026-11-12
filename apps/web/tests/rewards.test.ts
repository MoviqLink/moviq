import { needViewSchema, orderViewSchema, reservationSchema } from '@moviq/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ApiRequestError } from '../src/shared/api/errors';
import {
  createHoldFlow,
  type HoldEndpoints,
  type HoldState,
} from '../src/features/rewards/hold/flow';
import {
  canCancel,
  changesText,
  noOfferText,
  offersOf,
  ordersInOrder,
  questionsOf,
} from '../src/features/rewards/model/need';
import { serverWords } from '../src/features/rewards/model/server-words';
import { readShopper, saveShopper } from '../src/features/rewards/model/shopper';
import { qrMatrix } from '../src/features/rewards/qr/qr';
import { rewardsEn, rewardsEs } from '../src/features/rewards/texts';
import type { Checkout, CheckoutCallbacks } from '../src/features/trip/payment/flow';
import { need, offer, order, reservation } from './fixtures/rewards';

describe('the fixtures', () => {
  it('match the contracts', () => {
    expect(needViewSchema.safeParse(need({ offers: [offer()] })).success).toBe(true);
    expect(orderViewSchema.safeParse(order()).success).toBe(true);
    expect(reservationSchema.safeParse(reservation).success).toBe(true);
  });
});

describe('a need on the way', () => {
  it("shows Sara's recommendation first, then the largest reward, and leaves out the declined", () => {
    const view = need({
      offers: [
        offer({
          id: 'small',
          reward: { ...offer().reward, earned: { amountMinor: 100, currency: 'USD' } },
        }),
        offer({ id: 'declined', status: 'declined' }),
        offer({ id: 'best', recommended: true }),
        offer({ id: 'large' }),
      ],
    });
    expect(offersOf(view).map((o) => o.id)).toEqual(['best', 'large', 'small']);
  });

  it("puts a merchant's question in Spanish and sends the answer as the merchant wrote it", () => {
    const view = need({
      threads: [
        {
          id: 'thread-1',
          merchantId: 'demo-tsuki-ramen-house',
          status: 'awaiting-traveller',
          question: {
            topic: 'spice',
            text: 'Mild or hot for the Tonkotsu ramen?',
            options: ['mild', 'hot'],
          },
          conversation: [],
        },
      ],
    });
    expect(questionsOf(view, rewardsEs.question)).toEqual([
      {
        threadId: 'thread-1',
        text: '¿Suave o picante para el Tonkotsu ramen?',
        options: [
          { value: 'mild', label: 'Suave' },
          { value: 'hot', label: 'Picante' },
        ],
      },
    ]);
  });

  it('says when nobody can make it, and when the questions ran out', () => {
    expect(
      noOfferText(need({ message: 'No merchant on your next stops…' }), rewardsEn.offers),
    ).toBe(rewardsEn.offers.none);
    const exhausted = need({
      threads: [
        {
          id: 't',
          merchantId: 'm',
          status: 'closed',
          question: null,
          conversation: [
            {
              seq: 1,
              at: '2026-11-11T22:31:00.000Z',
              message: {
                type: 'closed',
                from: 'server',
                reason: 'clarifications-exhausted',
                message: 'Too many questions.',
              },
            },
          ],
        },
      ],
    });
    expect(noOfferText(exhausted, rewardsEs.offers)).toBe(rewardsEs.offers.closed);
    expect(noOfferText(need({ offers: [offer()] }), rewardsEn.offers)).toBeNull();
  });

  it('writes the kitchen changes in Spanish, ingredient names as the menu has them', () => {
    expect(changesText('without scallions, with chili oil', 'es')).toBe(
      'sin scallions, con chili oil',
    );
    expect(changesText('without scallions', 'en')).toBe('without scallions');
  });
});

describe('My orders', () => {
  it('can be cancelled for free only while the server says so and the order is reserved', () => {
    expect(canCancel(order())).toBe(true);
    expect(canCancel(order({ freeCancellation: false }))).toBe(false);
    expect(canCancel(order({ status: 'preparing' }))).toBe(false);
  });

  it('lists the orders to collect first, by pickup time', () => {
    const list = ordersInOrder([
      order({ id: 'done', status: 'picked_up', pickupAt: '2026-11-11T20:00:00.000Z' }),
      order({ id: 'later', pickupAt: '2026-11-11T23:50:00.000Z' }),
      order({ id: 'soon', pickupAt: '2026-11-11T23:10:00.000Z' }),
    ]);
    expect(list.map((o) => o.id)).toEqual(['soon', 'later', 'done']);
  });
});

describe('what Sara tells the merchants', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => {
        kept.set(key, value);
      },
    };
  };

  it('keeps a valid alias and tastes on the device, and refuses an alias with digits', () => {
    const store = memory();
    expect(readShopper(store, 'es').alias).toBe('Viajera');
    const taste = { ...readShopper(store, 'es').taste, allergies: ['soy' as const] };
    expect(saveShopper(store, { alias: 'Mia', taste })).toBe(true);
    expect(readShopper(store, 'en')).toEqual({ alias: 'Mia', taste });
    expect(saveShopper(store, { alias: 'Mia 2', taste })).toBe(false);
    expect(readShopper(store, 'en').alias).toBe('Mia');
  });

  it('starts again from the first tastes when what was kept is not valid', () => {
    const store = memory();
    store.setItem('moviq-shopper', '{"alias":"x","taste":{"allergies":["gluten"]}}');
    expect(readShopper(store, 'en').alias).toBe('Traveller');
  });
});

type Buyer = 'approves' | 'cancels' | 'approves-another-order';

function sdk(buyer: Buyer): Checkout {
  return {
    session: (callbacks: CheckoutCallbacks) => ({
      async start(opened: Promise<{ orderId: string }>) {
        const { orderId } = await opened;
        if (buyer === 'approves') await callbacks.onApprove(orderId);
        if (buyer === 'approves-another-order') await callbacks.onApprove('SOMEONE-ELSES');
        if (buyer === 'cancels') callbacks.onCancel();
      },
    }),
  };
}

async function hold(buyer: Buyer, endpoints: Partial<HoldEndpoints> = {}) {
  const states: HoldState[] = [];
  const calls = {
    reserve: vi.fn(endpoints.reserve ?? (() => Promise.resolve(reservation))),
    confirm: vi.fn(endpoints.confirm ?? (() => Promise.resolve(order()))),
  };
  const flow = createHoldFlow(
    { endpoints: calls, checkout: sdk(buyer) },
    { offerId: 'offer-1', language: 'es' },
    (state) => states.push(state),
  );
  flow.reserve();
  flow.reserve();
  await vi.waitFor(() => {
    expect(['reserved', 'cancelled', 'failed', 'unconfirmed']).toContain(states.at(-1)?.step);
  });
  return { states, calls, last: states.at(-1) };
}

const httpError = (status: number, message: string | null = 'This offer has expired.') =>
  new ApiRequestError({ kind: 'http', status, code: 'conflict', message, requestId: null });

describe('reserving with PayPal', () => {
  it('opens one PayPal order however many presses, and is reserved only with the server order', async () => {
    const { calls, last, states } = await hold('approves');
    expect(calls.reserve).toHaveBeenCalledTimes(1);
    expect(calls.reserve).toHaveBeenCalledWith('offer-1', 'es');
    expect(calls.confirm).toHaveBeenCalledTimes(1);
    expect(states.map((s) => s.step)).toEqual(['creating', 'approving', 'confirming', 'reserved']);
    expect(last).toEqual({ step: 'reserved', order: order() });
  });

  it('holds nothing when the buyer closes PayPal, or approves an order that is not ours', async () => {
    const closed = await hold('cancels');
    expect(closed.last?.step).toBe('cancelled');
    expect(closed.calls.confirm).not.toHaveBeenCalled();
    const other = await hold('approves-another-order');
    expect(other.last).toEqual({ step: 'failed', why: 'other', message: null });
    expect(other.calls.confirm).not.toHaveBeenCalled();
  });

  it('says the offer is gone (409) or PayPal unreachable (503) when the server refuses to open it', async () => {
    const gone = await hold('approves', { reserve: () => Promise.reject(httpError(409)) });
    expect(gone.last).toEqual({ step: 'failed', why: 'gone', message: 'This offer has expired.' });
    const down = await hold('approves', { reserve: () => Promise.reject(httpError(503)) });
    expect(down.last).toEqual({ step: 'failed', why: 'unreachable', message: null });
  });

  it('waits for PayPal when the server has not settled the hold, and says the offer is gone on 409', async () => {
    const pending = await hold('approves', {
      confirm: () => Promise.resolve({ status: 'unknown' }),
    });
    expect(pending.last?.step).toBe('unconfirmed');
    const refused = await hold('approves', { confirm: () => Promise.reject(httpError(409)) });
    expect(refused.last).toEqual({
      step: 'failed',
      why: 'gone',
      message: 'This offer has expired.',
    });
  });
});

describe("the server's refusals", () => {
  it('are said as the server wrote them, in Spanish too, the release still in progress included', () => {
    const releasing =
      'We could not keep this reservation. The money held in PayPal is being released; nothing will be charged.';
    expect(serverWords(releasing, 'en')).toBe(releasing);
    expect(serverWords(releasing, 'es')).toBe(
      'No hemos podido mantener esta reserva. El dinero retenido en PayPal se está liberando; no se cobrará nada.',
    );
    expect(serverWords('Something new.', 'es')).toBe(
      'El servidor dice, en inglés: «Something new.»',
    );
    expect(serverWords(null, 'es')).toBeNull();
  });
});

describe('the QR of the pickup code', () => {
  const finder = (m: readonly (readonly boolean[])[], x: number, y: number) =>
    [0, 1, 2, 3, 4, 5, 6].every((i) => m[y]?.[x + i] === true && m[y + 6]?.[x + i] === true);

  it('picks the smallest version: 21 modules for a short text, 45 for a signed code', () => {
    expect(qrMatrix('HELLO')).toHaveLength(21);
    const code = `m1.3f2a9c1e-1b2c-4d5e-8f90-1234567890ab.${'n'.repeat(22)}.1794519000.${'s'.repeat(43)}`;
    const matrix = qrMatrix(code);
    expect(matrix).toHaveLength(45);
    expect(matrix.every((row) => row.length === 45)).toBe(true);
  });

  it('draws the three finder patterns, the timing lines and the dark module', () => {
    const m = qrMatrix('HELLO');
    expect(finder(m, 0, 0) && finder(m, 14, 0) && finder(m, 0, 14)).toBe(true);
    expect([8, 9, 10, 11, 12].map((x) => m[6]?.[x])).toEqual([true, false, true, false, true]);
    expect(m[21 - 8]?.[8]).toBe(true);
  });

  it('is the same code every time for the same text', () => {
    expect(qrMatrix('T-1041')).toEqual(qrMatrix('T-1041'));
  });
});
