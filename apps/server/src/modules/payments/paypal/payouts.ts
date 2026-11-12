import type { Money } from '@moviq/contracts';
import { z } from 'zod';

import { parsed, requester, type PayPalClientOptions } from './transport.js';
import { toPayPalAmount } from './schemas.js';

/**
 * PayPal Payouts v1 (`/v1/payments/payouts`): one batch per merchant and settlement. PayPal
 * refuses a `sender_batch_id` it saw in the last 30 days, and the call also carries a
 * `PayPal-Request-Id`, so a retry never pays twice.
 */
export interface PayPalPayouts {
  createBatch(input: {
    readonly senderBatchId: string;
    readonly emailSubject: string;
    readonly receiver: string;
    readonly amount: Money;
    readonly note: string;
  }): Promise<PayoutBatch>;
  getBatch(payoutBatchId: string): Promise<PayoutBatch>;
}

const batchStatusSchema = z.enum(['DENIED', 'PENDING', 'PROCESSING', 'SUCCESS', 'CANCELED']);

const payoutBatchSchema = z.object({
  batch_header: z.object({
    payout_batch_id: z.string().min(1).max(30),
    batch_status: batchStatusSchema,
    sender_batch_header: z.object({ sender_batch_id: z.string().min(1) }),
  }),
  items: z
    .array(
      z.object({
        payout_item_id: z.string().min(1),
        transaction_status: z.string().optional(),
      }),
    )
    .optional(),
});

export type PayoutBatch = z.infer<typeof payoutBatchSchema>;
export type PayoutBatchStatus = z.infer<typeof batchStatusSchema>;

export function createPayPalPayouts(options: PayPalClientOptions): PayPalPayouts {
  const request = requester(options);
  return {
    createBatch: (input) =>
      parsed(request, payoutBatchSchema, {
        operation: 'payouts.create',
        method: 'POST',
        path: '/v1/payments/payouts',
        requestId: input.senderBatchId,
        body: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: input.senderBatchId,
            email_subject: input.emailSubject,
          },
          items: [
            {
              recipient_type: 'EMAIL',
              receiver: input.receiver,
              amount: {
                value: toPayPalAmount(input.amount).value,
                currency: input.amount.currency,
              },
              note: input.note,
              sender_item_id: input.senderBatchId,
            },
          ],
        }),
      }),
    getBatch: (payoutBatchId) =>
      parsed(request, payoutBatchSchema, {
        operation: 'payouts.get',
        method: 'GET',
        path: `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`,
      }),
  };
}
