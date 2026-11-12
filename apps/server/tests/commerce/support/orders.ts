import { needViewSchema, orderViewSchema, reservationSchema } from '@moviq/contracts';

import { MERCHANT_TEST_TOKEN } from '../../support/merchant-access.js';

import type { PayoutBatch, PayPalPayouts } from '../../../src/modules/payments/paypal/payouts.js';
import { browser, needRequest, type CommerceWorld } from './commerce.js';

/** PayPal Payouts in memory: each sender batch id is paid once; the status is the test's. */
export function fakePayouts(status: { value: 'PENDING' | 'DENIED' | 'SUCCESS' }) {
  const batches = new Map<string, PayoutBatch>();
  const payouts: PayPalPayouts & { readonly sent: { receiver: string; amountMinor: number }[] } = {
    sent: [],
    createBatch: (input) => {
      const existing = batches.get(input.senderBatchId);
      if (existing !== undefined) return Promise.resolve(existing);
      payouts.sent.push({ receiver: input.receiver, amountMinor: input.amount.amountMinor });
      const batch: PayoutBatch = {
        batch_header: {
          payout_batch_id: `PB${String(batches.size + 1)}`,
          batch_status: status.value,
          sender_batch_header: { sender_batch_id: input.senderBatchId },
        },
      };
      batches.set(input.senderBatchId, batch);
      return Promise.resolve(batch);
    },
    getBatch: (id) =>
      Promise.resolve(
        [...batches.values()].find((b) => b.batch_header.payout_batch_id === id) ??
          Promise.reject(new Error('none')),
      ),
  };
  return payouts;
}

export async function merchantSession(
  current: CommerceWorld,
  merchantId = 'demo-tsuki-ramen-house',
) {
  const merchant = browser(current.app);
  await merchant.post('/api/merchant/session', { token: MERCHANT_TEST_TOKEN, merchantId });
  return merchant;
}

/** A ramen order reserved, approved in PayPal and collected at the counter. */
export async function collectedOrder(current: CommerceWorld) {
  const traveller = browser(current.app);
  const need = needViewSchema.parse(
    (await traveller.post('/api/commerce/needs', needRequest())).body,
  );
  const offerId = need.offers[0]?.id ?? '';
  const reservation = reservationSchema.parse(
    (await traveller.post(`/api/commerce/offers/${offerId}/reserve`, { language: 'en' })).body,
  );
  current.paypal.approve(reservation.paypalOrderId);
  const order = orderViewSchema.parse(
    (await traveller.post(`/api/commerce/offers/${offerId}/confirm`)).body,
  );
  const merchant = await merchantSession(current);
  await merchant.post('/api/merchant/scan', { code: order.pickup?.qr });
  return { order, merchant, traveller };
}
